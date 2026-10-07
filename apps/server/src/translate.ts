import { Agent } from '@mastra/core/agent';
import { ollamaModel } from './agent.js';
import { createCache } from './cache.js';
import type { Feature } from './conditions/features.js';
import { RUN_COLD_TIP, RUN_WARM_TIP } from './outfit.js';
import {
  FEATURE_IDEAS,
  RAIN_UNLIKELY_PERCENT,
  type RecommendResponse,
  SEASON_IDEA,
  STRETCH_IDEA,
  SUNSET_IDEA,
} from './recommend.js';

const TRANSLATE_ATTEMPTS = 2;
/** Low, so the translation stays close to the English instead of adding its own ideas. */
const TEMPERATURE = 0.2;
/** The same English text always reads the same in Korean; the limit only keeps memory bounded. */
const TRANSLATION_TTL_MS = 6 * 60 * 60 * 1000;

/** Names are swapped for these before translating, so Gemma can't translate or romanize them. */
const PLACE = '{PLACE}';
const STATION = '{STATION}';

export const translatorAgent = new Agent({
  id: 'translator-agent',
  name: 'Translator',
  instructions: `You translate short English texts from an app that suggests a short outing into natural Korean.
You receive a JSON array of strings. Respond with ONLY a JSON array of strings, no markdown, with exactly as many
items, where each item is the Korean translation of the item at the same position.

Rules:
- The first item is a title. Translate it as a short noun phrase with no verb ending,
  e.g. "A relaxing stroll through {PLACE}" becomes "{PLACE}에서 느긋한 산책".
- Every other item is a sentence or a short instruction. End each with one polite ending such as 해요 or 하세요,
  e.g. "Look for autumn leaves" becomes "단풍을 찾아보세요".
- Keep ${PLACE} and ${STATION} exactly as written; they stand for names. Right after them use only particles that
  fit any word, such as 에, 에서, 까지, or 의; never 을/를, 이/가, 은/는, 와/과, or 으로/로.
- Keep every number with its unit: "12°C" stays "12°C", "850 m" stays "850 m", "45 minutes" becomes "45분".
- Write natural, everyday Korean rather than word-for-word. No emojis. Don't add, merge, drop, or explain items.

Example input:
["Ride a public bike to {PLACE}","The air quality index is 38 and it feels like 18°C, with only a 10% chance of rain.","Play frisbee on the lawn","Wear a light layer you can take off as you warm up."]
Example output:
["{PLACE}까지 공공자전거 타기","대기질 지수는 38이고 체감 온도는 18°C, 비 올 확률은 10%뿐이에요.","잔디밭에서 프리스비를 던져 보세요","몸이 데워지면 벗을 수 있게 얇은 겉옷을 입으세요."]`,
  model: ollamaModel,
});

const FEATURE_IDEAS_KOREAN: Partial<Record<Feature, string>> = {
  viewpoint: '전망대에서 경치를 감상해 보세요',
  water: '물가에 앉아 몇 분 조용히 쉬어 보세요',
  'outdoor gym': '야외 운동기구로 가볍게 몇 세트 해 보세요',
  'running track': '트랙을 한 바퀴 가볍게 뛰어 보세요',
  'sports field': '운동장에서 경기를 몇 분 구경해 보세요',
  playground: '놀이터에서 그네를 타 보세요',
  benches: '돌아가기 전에 벤치에서 몇 분 쉬어 가세요',
  'drinking fountain': '음수대에서 물을 채워 가세요',
};

/** Fixed server texts, so they never wait for Gemma. */
const FIXED_KOREAN: Record<string, string> = {
  [RUN_COLD_TIP]: '추위를 타면 한 겹 더 따뜻하게 입으세요.',
  [RUN_WARM_TIP]: '더위를 타면 한 겹 가볍게 입으세요.',
  [STRETCH_IDEA]: '5분 동안 다리와 어깨를 쭉 펴 보세요',
  [SEASON_IDEA]: '주변에서 계절이 느껴지는 것 세 가지를 찾아보세요',
  ...Object.fromEntries(
    Object.entries(FEATURE_IDEAS).map(([feature, idea]) => [idea, FEATURE_IDEAS_KOREAN[feature as Feature]]),
  ),
};
const FEELS_LIKE_TIP = /^Feels like (-?\d+)°C out there\.$/;

function fixedKorean(text: string): string | undefined {
  const feelsLike = FEELS_LIKE_TIP.exec(text);
  if (feelsLike) return `체감 온도는 ${feelsLike[1]}°C예요.`;
  const sunset = SUNSET_IDEA.exec(text);
  if (sunset) return `${sunset[1]}쯤 노을을 보세요`;
  return FIXED_KOREAN[text];
}

const AIR_KOREAN: Record<string, string> = {
  good: '좋음',
  fair: '괜찮음',
  moderate: '보통',
  poor: '나쁨',
  'very poor': '매우 나쁨',
  'extremely poor': '최악',
};

/**
 * The rule-based answer's activity and reason, written from the same facts as the English. It only comes when
 * Gemma just failed, so Gemma isn't asked to translate it.
 */
function ruleBasedKorean({ recommendation, conditions, place, bikeStation }: RecommendResponse) {
  const air = AIR_KOREAN[conditions.airQuality] ?? conditions.airQuality;
  const summary = `${conditions.temperatureC}°C, 대기질 ${air}`;
  if (recommendation.verdict === 'stay') {
    const rain = conditions.rainChance >= RAIN_UNLIKELY_PERCENT ? `, 비 올 확률 ${conditions.rainChance}%` : '';
    return {
      activity: '창문을 열고 10분 동안 스트레칭하기',
      reason: `지금은 나가기 좋은 때가 아니에요 (${summary}${rain}).`,
    };
  }
  if (bikeStation) {
    const rideTo = place ? ` ${place.name}까지` : '';
    return {
      activity: `${bikeStation.name}에서 자전거를 빌려${rideTo} 타기`,
      reason: `${summary}, 대여소에 자전거가 ${bikeStation.bikesAvailable}대 있어요.`,
    };
  }
  return {
    activity: place ? `${place.name}까지 걸어갔다 오기` : '동네 한 바퀴 걷기',
    reason: `${summary}. 산책하기 괜찮은 날씨예요.`,
  };
}

const HANGUL = /[가-힣]/;
const NUMBER = /\d+(?:\.\d+)?/g;
const count = (text: string, part: string) => text.split(part).length - 1;

/** The weather numbers are the point of the reason, so a translation may not drop or change any. */
function keepsNumbers(translated: string, source: string) {
  const kept = new Set(translated.match(NUMBER));
  return (source.match(NUMBER) ?? []).every((number) => kept.has(number));
}

/** Null unless every item came back in Korean, in order, keeping the same name placeholders and numbers. */
export function parseTranslation(output: string, sources: string[]): string[] | null {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  const json = output.slice(start, end + 1);
  let items: unknown;
  try {
    items = JSON.parse(json);
  } catch {
    // Gemma sometimes quotes the items with typographic quotes.
    try {
      items = JSON.parse(json.replace(/[“”]/g, '"'));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(items) || items.length !== sources.length) return null;
  const valid = items.every(
    (item, index) =>
      typeof item === 'string' &&
      HANGUL.test(item) &&
      keepsNumbers(item, sources[index]) &&
      [PLACE, STATION].every((name) => count(item, name) > 0 === count(sources[index], name) > 0),
  );
  // Gemma sometimes doubles the polite ending ("하세요요").
  return valid ? (items as string[]).map((item) => item.trim().replace(/요요([.!]?)$/, '요$1')) : null;
}

const translations = createCache<string[]>({ ttlMs: TRANSLATION_TTL_MS, maxEntries: 500 });

function askTranslator(agent: Agent, texts: string[]) {
  return translations.getOrLoad(JSON.stringify(texts), async () => {
    for (let attempt = 1; attempt <= TRANSLATE_ATTEMPTS; attempt++) {
      try {
        const result = await agent.generate(JSON.stringify(texts), { modelSettings: { temperature: TEMPERATURE } });
        const korean = parseTranslation(result.text, texts);
        if (korean) return korean;
        console.warn(`Translation was invalid (attempt ${attempt}):`, result.text);
      } catch (error) {
        console.warn(`Translation failed (attempt ${attempt}):`, (error as Error).message);
      }
    }
    throw new Error('No valid translation');
  });
}

interface Names {
  place: string | undefined;
  station: string | undefined;
}

function mask(text: string, { place, station }: Names) {
  let masked = text;
  // The longer name first, in case one contains the other.
  const swaps: [string | undefined, string][] = [
    [place, PLACE],
    [station, STATION],
  ];
  swaps.sort(([a = ''], [b = '']) => b.length - a.length);
  for (const [name, placeholder] of swaps) if (name) masked = masked.replaceAll(name, placeholder);
  return masked;
}

const unmask = (text: string, { place, station }: Names) =>
  text.replaceAll(PLACE, place ?? '').replaceAll(STATION, station ?? '');

/** Korean for the fixed texts among these, keyed by the English. */
function fixedTranslations(texts: string[]) {
  const korean = new Map<string, string>();
  for (const text of texts) {
    const fixed = fixedKorean(text);
    if (fixed) korean.set(text, fixed);
  }
  return korean;
}

/** Korean for each text, keyed by the English; null when Gemma couldn't translate them. */
async function translateTexts(texts: string[], names: Names, agent: Agent): Promise<Map<string, string> | null> {
  const korean = fixedTranslations(texts);
  const open = [...new Set(texts)].filter((text) => !korean.has(text));
  if (open.length === 0) return korean;

  try {
    const translated = await askTranslator(
      agent,
      open.map((text) => mask(text, names)),
    );
    open.forEach((text, index) => {
      korean.set(text, unmask(translated[index], names));
    });
    return korean;
  } catch {
    return null;
  }
}

/**
 * The suggestion's words in Korean. Gemma answers and the server checks it in English first; only the final
 * text is translated, so names, ids, and the scenes picked from the English stay as they were.
 */
export async function translateResponse(response: RecommendResponse, agent: Agent): Promise<RecommendResponse> {
  const { recommendation, outfits } = response;
  const ruleBased = response.source === 'fallback' ? ruleBasedKorean(response) : null;
  const texts = [
    ...(ruleBased ? [] : [recommendation.activity, recommendation.reason]),
    ...(recommendation.thingsToDo ?? []),
    ...(recommendation.safetyNote ? [recommendation.safetyNote] : []),
    ...outfits.map(({ outfit }) => outfit.tip),
  ];
  const names = { place: response.place?.name, station: response.bikeStation?.name };
  const korean = ruleBased ? fixedTranslations(texts) : await translateTexts(texts, names, agent);
  if (!korean) return response;
  const say = (text: string) => korean.get(text) ?? text;

  return {
    ...response,
    recommendation: {
      ...recommendation,
      activity: ruleBased?.activity ?? say(recommendation.activity),
      reason: ruleBased?.reason ?? say(recommendation.reason),
      thingsToDo: recommendation.thingsToDo?.map(say),
      safetyNote: recommendation.safetyNote && say(recommendation.safetyNote),
    },
    outfits: outfits.map((option) => ({ ...option, outfit: { ...option.outfit, tip: say(option.outfit.tip) } })),
  };
}
