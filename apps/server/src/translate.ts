import { Agent } from '@mastra/core/agent';
import { ollamaModel } from './agent.js';
import { createCache } from './cache.js';
import { RUN_COLD_TIP, RUN_WARM_TIP } from './outfit.js';
import type { RecommendResponse } from './recommend.js';

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

/** Fixed server texts, so they never wait for Gemma. */
const FIXED_KOREAN: Record<string, string> = {
  [RUN_COLD_TIP]: '추위를 타면 한 겹 더 따뜻하게 입으세요.',
  [RUN_WARM_TIP]: '더위를 타면 한 겹 가볍게 입으세요.',
};
const FEELS_LIKE_TIP = /^Feels like (-?\d+)°C out there\.$/;

function fixedKorean(text: string) {
  const feelsLike = FEELS_LIKE_TIP.exec(text);
  if (feelsLike) return `체감 온도는 ${feelsLike[1]}°C예요.`;
  return FIXED_KOREAN[text];
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

/** Korean for each text, keyed by the English; null when Gemma couldn't translate them. */
async function translateTexts(texts: string[], names: Names, agent: Agent): Promise<Map<string, string> | null> {
  const korean = new Map<string, string>();
  const open = [...new Set(texts)].filter((text) => {
    const fixed = fixedKorean(text);
    if (fixed) korean.set(text, fixed);
    return !fixed;
  });
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
  const texts = [
    recommendation.activity,
    recommendation.reason,
    ...(recommendation.thingsToDo ?? []),
    ...(recommendation.safetyNote ? [recommendation.safetyNote] : []),
    ...outfits.map(({ outfit }) => outfit.tip),
  ];
  const names = { place: response.place?.name, station: response.bikeStation?.name };
  const korean = await translateTexts(texts, names, agent);
  if (!korean) return response;
  const say = (text: string) => korean.get(text) ?? text;

  return {
    ...response,
    recommendation: {
      ...recommendation,
      activity: say(recommendation.activity),
      reason: say(recommendation.reason),
      thingsToDo: recommendation.thingsToDo?.map(say),
      safetyNote: recommendation.safetyNote && say(recommendation.safetyNote),
    },
    outfits: outfits.map((option) => ({ ...option, outfit: { ...option.outfit, tip: say(option.outfit.tip) } })),
  };
}
