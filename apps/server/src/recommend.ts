import { setTimeout as sleep } from 'node:timers/promises';
import type { Agent } from '@mastra/core/agent';
import { getAirQuality, type AirQuality } from './conditions/airQuality.js';
import { getNearbyBikeStations, type BikeStation } from './conditions/bikes.js';
import { getParkFeatures, type Feature } from './conditions/features.js';
import { getNearbyParks, walkableRadiusM, type Place } from './conditions/places.js';
import { getRoundTripWalk, getRoundTripWalks, type Route } from './conditions/route.js';
import { getWeather, type Weather } from './conditions/weather.js';
import type { LatLon } from './geo.js';
import { baselineOutfit, outfitOptions, withRequiredExtras, type Outfit } from './outfit.js';
import { recommendationSchema, type Interest, type Preferences, type Recommendation } from './schema.js';

export interface Park extends Place {
  /** What OpenStreetMap shows around the park; null when it couldn't be checked in time. */
  features: Feature[] | null;
  /** Measured walking time there and back; null when the router didn't answer in time. */
  roundTripMin: number | null;
}

export interface Conditions {
  availableMinutes: number;
  weather: Weather;
  airQuality: AirQuality;
  nearbyBikeStations: BikeStation[] | null;
  nearbyParks: Park[];
  baselineOutfit: Outfit;
  /** Null when the person lets the AI decide everything. */
  preferences: Preferences | null;
}

const MODEL_ATTEMPTS = 2;
/** Overpass usually answers in about 3 s and OSRM in about 1 s; past that the model plans without them. */
const DETAILS_WAIT_MS = 3000;
const MAX_THINGS_TO_DO = 3;
/** Shorter outings aren't worth unlocking and docking a public bike. */
const MIN_BIKE_MINUTES = 30;

function optional<T>(promise: Promise<T>, label: string, fallback: T) {
  return promise.catch((error) => {
    console.warn(`Skipping ${label}:`, (error as Error).message);
    return fallback;
  });
}

/** A slow answer still lands in its cache, so asking again from the same spot gets it. */
async function withinWait<T>(promise: Promise<T>, label: string): Promise<T | null> {
  const result = await optional(Promise.race([promise, sleep(DETAILS_WAIT_MS, 'late' as const)]), label, null);
  if (result !== 'late') return result;
  console.warn(`Skipping ${label}: no answer within ${DETAILS_WAIT_MS} ms`);
  return null;
}

async function withDetails(origin: LatLon, places: Place[], availableMinutes: number): Promise<Park[]> {
  if (places.length === 0) return [];
  const [features, routes] = await Promise.all([
    withinWait(Promise.all(getParkFeatures(places)), 'park features'),
    withinWait(Promise.all(getRoundTripWalks(origin, places)), 'round trips'),
  ]);
  const parks = places.map((place, index) => ({
    ...place,
    features: features?.[index] ?? null,
    roundTripMin: routes?.[index].durationMin ?? null,
  }));
  // The search radius assumes a typical detour, so some real round trips take longer than the time available.
  return parks.filter((park) => park.roundTripMin === null || park.roundTripMin <= availableMinutes);
}

export async function getConditions(
  origin: LatLon,
  availableMinutes: number,
  preferences: Preferences | null,
): Promise<Conditions> {
  const [weather, airQuality, nearbyBikeStations, nearbyParks] = await Promise.all([
    getWeather(origin.lat, origin.lon),
    getAirQuality(origin.lat, origin.lon),
    availableMinutes >= MIN_BIKE_MINUTES
      ? optional(getNearbyBikeStations(origin.lat, origin.lon), 'bike stations', null)
      : null,
    optional(getNearbyParks(origin, walkableRadiusM(availableMinutes)), 'parks', []).then((places) =>
      withDetails(origin, places, availableMinutes),
    ),
  ]);
  return {
    availableMinutes,
    weather,
    airQuality,
    nearbyBikeStations,
    nearbyParks,
    baselineOutfit: baselineOutfit(weather, airQuality),
    preferences,
  };
}

function parseModelOutput(text: string): Recommendation | null {
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd <= jsonStart) return null;

  try {
    const result = recommendationSchema.safeParse(JSON.parse(text.slice(jsonStart, jsonEnd + 1)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function isUnsafeOutside({ weather, airQuality }: Conditions) {
  return (
    weather.precipitationMm > 0.5 ||
    weather.maxPrecipitationChanceNext3h >= 70 ||
    ['poor', 'very poor', 'extremely poor'].includes(airQuality.level)
  );
}

function conditionsSummary({ weather, airQuality }: Conditions) {
  return `${weather.temperatureC}°C, ${weather.description}, air quality ${airQuality.level}`;
}

const PLACE_WORDS = /\b(park|garden|plaza|square)s?\b/i;
const HANGUL = /\p{Script=Hangul}/u;
const PARK_WORDS = /\b(parks?|gardens?|forests?|groves?|trails?|arboretum)\b|공원|숲/i;
const CAPITALIZED_WORDS = ['celsius', 'fahrenheit', 'european', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const SUBJECTS = [
  'it', 'this', 'that', 'there', 'here', 'what', 'today', 'tonight', 'now', 'everything', 'nothing', 'outside',
  'air', 'weather', 'temperature', 'wind', 'rain', 'sun', 'sunset', 'sky', 'skies', 'uv', 'conditions', 'humidity', 'visibility',
];
const PREDICATES = new Set([
  'is', 'was', 'has', 'offers', 'provides', 'looks', 'feels', 'seems', 'sits', 'lies', 'awaits', 'makes',
  'would', 'will', 'should', 'can', 'could', 'might',
]);

/** A capitalized word after the first one is usually a name, e.g. "a visit to Joseukingmardang". */
function hasName(sentence: string, allowed: Set<string>) {
  const words = sentence.split(/\s+/).map((word) => word.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''));
  const [first = '', second = ''] = words;
  const firstBase = first.replace(/['’]s$/, '').toLowerCase();
  // The first word is always capitalized, so only treat it as a name when it is the subject, as in "Joseukingmardang is lovely".
  const startsWithName =
    /^\p{Lu}\p{Ll}/u.test(first) &&
    !allowed.has(firstBase) &&
    !SUBJECTS.includes(firstBase) &&
    !firstBase.endsWith('ing') &&
    (first !== first.replace(/['’]s$/, '') || PREDICATES.has(second.toLowerCase()));
  const namedLater = words
    .slice(1)
    .some((word) => /^\p{Lu}\p{Ll}/u.test(word) && !allowed.has(word.toLowerCase()));
  return startsWithName || namedLater;
}

function namesAPlace(text: string, { weather, airQuality, nearbyParks }: Conditions) {
  const allowed = new Set([...CAPITALIZED_WORDS, ...`${weather.description} ${airQuality.level}`.toLowerCase().split(/\s+/)]);
  return HANGUL.test(text) || hasName(text, allowed) || nearbyParks.some((park) => text.includes(park.name));
}

/** Below this chance, with nothing falling now, rain isn't worth mentioning. */
const RAIN_UNLIKELY_PERCENT = 20;
/** At or above this chance, or while it's falling, saying "no rain" is wrong. */
const RAIN_LIKELY_PERCENT = 50;
const RAIN_WORDS = /\b(rain\w*|precipitation|showers?|drizzle)\b/i;
/** A denial next to the rain word, like "no chance of rain" or "rain is unlikely", not any "not" in the sentence. */
const NO_RAIN_WORDS =
  /\b(?:no|zero|without)\b(?:\W+\w+){0,2}?\W+(?:rain|precipitation|showers?|drizzle)|\b(?:rain|precipitation|showers?)\w*(?:\W+\w+){0,2}?\W+(?:unlikely|not expected)|\bdry\b|\b0\s?%/i;

const numbersBefore = (sentence: string, unit: RegExp) =>
  [...sentence.matchAll(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s?${unit.source}`, 'gi'))].map((match) => Number(match[1]));
const numberAfter = (sentence: string, label: RegExp) => {
  const match = sentence.match(new RegExp(`${label.source}\\D{0,12}?(\\d+(?:\\.\\d+)?)`, 'i'));
  return match ? Number(match[1]) : undefined;
};
const near = (value: number, targets: number[], tolerance: number) =>
  targets.some((target) => Math.abs(value - target) <= tolerance);

/** True if a sentence states a number or rain outlook that the measured conditions don't support. */
function contradictsConditions(sentence: string, { weather, airQuality }: Conditions) {
  const rainChances = [weather.maxPrecipitationChanceNext3h, ...weather.precipitationChanceByHour.map((hour) => hour.chance)];
  const falling = weather.precipitationMm > 0;
  const mentionsRain = RAIN_WORDS.test(sentence);
  const deniesRain = NO_RAIN_WORDS.test(sentence);
  if (mentionsRain && !deniesRain && !falling && weather.maxPrecipitationChanceNext3h < RAIN_UNLIKELY_PERCENT) return true;
  if (mentionsRain && deniesRain && (falling || weather.maxPrecipitationChanceNext3h >= RAIN_LIKELY_PERCENT)) return true;

  const temperatures = numbersBefore(sentence, /°\s?C/);
  const percents = mentionsRain ? numbersBefore(sentence, /%/) : [];
  const winds = numbersBefore(sentence, /km\/?h/);
  const aqi = numberAfter(sentence, /air quality index/);
  const uv = numberAfter(sentence, /\bUV(?: index)?/);
  return (
    temperatures.some((value) => !near(value, [weather.temperatureC, weather.feelsLikeC], 1)) ||
    percents.some((value) => !near(value, rainChances, 5)) ||
    winds.some((value) => !near(value, [weather.windKmh], 2)) ||
    (aqi !== undefined && !near(aqi, [airQuality.europeanAqi], 2)) ||
    (uv !== undefined && !near(uv, [weather.uvIndex], 1))
  );
}

function rainNote(weather: Weather) {
  const relevant = weather.precipitationMm > 0 || weather.maxPrecipitationChanceNext3h >= RAIN_UNLIKELY_PERCENT;
  return relevant ? `, ${weather.maxPrecipitationChanceNext3h}% chance of rain` : '';
}

/** The reason should only cite measured conditions; a park named there may be garbled or differ from the map. */
function checkReason(reason: string, conditions: Conditions) {
  const sentences = reason
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence && !PLACE_WORDS.test(sentence) && !namesAPlace(sentence, conditions))
    .filter((sentence) => !contradictsConditions(sentence, conditions));
  return sentences.length > 0 ? sentences.join(' ') : `${conditionsSummary(conditions)}.`;
}

/** Words that mean a facility is there, so a suggestion using them needs that feature at the park. */
const FEATURE_WORDS: Record<Feature, RegExp> = {
  playground: /\b(playground|swings?|slides?|seesaw)\b/i,
  'sports field': /\b(pitch|field|court|basketball|soccer|football|tennis|badminton|hoops)\b/i,
  'running track': /\btrack\b/i,
  'outdoor gym': /\b(outdoor gym|fitness|exercise equipment|pull-?ups?|workout station)\b/i,
  benches: /\bbench(es)?\b/i,
  'drinking fountain': /\b(fountain|drinking water|refill)\b/i,
  toilets: /\b(toilets?|restrooms?|bathrooms?)\b/i,
  viewpoint: /\b(viewpoint|lookout|overlook)\b/i,
  water: /\b(pond|lake|stream|river|creek|ducks?|fish|koi|water's edge|by the water)\b/i,
};

const FEATURE_IDEAS: Partial<Record<Feature, string>> = {
  viewpoint: 'Take in the view from the viewpoint',
  water: 'Sit by the water for a few quiet minutes',
  'outdoor gym': 'Do a few easy sets at the outdoor gym',
  'running track': 'Jog one easy lap of the track',
  'sports field': 'Watch a few minutes of a game at the sports field',
  playground: 'Give the swings at the playground a try',
  benches: 'Rest on a bench for a few minutes before heading back',
  'drinking fountain': 'Refill your water at the drinking fountain',
};

function fallbackThingsToDo(features: Feature[], { weather, availableMinutes, preferences }: Conditions) {
  const ideas: string[] = [];
  if (weather.minutesUntilSunset > 0 && weather.minutesUntilSunset < availableMinutes) {
    ideas.push(`Catch the sunset around ${weather.sunset.slice(11, 16)}`);
  }
  const wanted = wantedFeatures(preferences);
  const relaxed = preferences?.pace === 'easy' && !preferences.interests.includes('exercise');
  const wantedFirst = features
    .filter((feature) => !(relaxed && EFFORT_FEATURES.includes(feature)))
    .sort((a, b) => Number(wanted.has(b)) - Number(wanted.has(a)));
  ideas.push(...wantedFirst.flatMap((feature) => FEATURE_IDEAS[feature] ?? []));
  ideas.push('Stretch your legs and shoulders for five minutes', 'Spot three signs of the season around you');
  return ideas.slice(0, MAX_THINGS_TO_DO);
}

/** Facilities that are good to know about but aren't something to do. */
const NOT_ACTIVITIES: Feature[] = ['toilets'];

/** Keeps only suggestions the destination can support; unknown features count as none. */
function checkThingsToDo(items: string[] | null | undefined, park: Park | undefined, conditions: Conditions) {
  const features = park?.features ?? [];
  const missing = (Object.keys(FEATURE_WORDS) as Feature[]).filter(
    (feature) => !features.includes(feature) || NOT_ACTIVITIES.includes(feature),
  );
  const checked = (items ?? [])
    .map((item) => item.trim().replace(/\.$/, ''))
    .filter((item) => !/\bamenities\b/i.test(item))
    .filter((item) => item && !namesAPlace(item, conditions))
    .filter((item) => !missing.some((feature) => FEATURE_WORDS[feature].test(item)))
    .slice(0, MAX_THINGS_TO_DO);
  return checked.length > 0 ? checked : fallbackThingsToDo(features, conditions);
}

/** What the walk preview shows for each thing to do. */
export type ThingScene = Exclude<Feature, 'toilets'> | 'sunset' | 'stretch' | 'season' | 'photo' | 'rest' | 'walk';

const isSceneFeature = (feature: Feature): feature is Exclude<Feature, 'toilets'> => !NOT_ACTIVITIES.includes(feature);

const SCENE_WORDS: [ThingScene, RegExp][] = [
  ['sunset', /\b(sunset|sundown|golden hour)\b/i],
  ...(Object.keys(FEATURE_WORDS) as Feature[])
    .filter(isSceneFeature)
    .map((feature): [ThingScene, RegExp] => [feature, FEATURE_WORDS[feature]]),
  ['stretch', /\b(stretch\w*|yoga|breath\w*|warm[- ]?up)\b/i],
  ['photo', /\b(photos?|pictures?|snap)\b/i],
  ['season', /\b(seasons?|leaves|flowers?|blossoms?|trees?|birds?|autumn|fall colou?rs?|spring|summer|winter)\b/i],
  ['rest', /\b(sit|rest|relax|read|pause|unwind)\b/i],
];

export function sceneFor(thing: string): ThingScene {
  return SCENE_WORDS.find(([, words]) => words.test(thing))?.[0] ?? 'walk';
}

const EXERCISE_FEATURES: Feature[] = ['sports field', 'running track', 'outdoor gym'];
/** Ideas at these features mean working out, which doesn't fit an easy, relaxed pace. */
const EFFORT_FEATURES: Feature[] = ['running track', 'outdoor gym'];
const INTEREST_FEATURES: Record<Interest, Feature[]> = {
  exercise: EXERCISE_FEATURES,
  water: ['water'],
  views: ['viewpoint'],
  greenery: [],
  quiet: [],
};

/** Features that match the person's answers, used to rank parks when the model isn't available. */
function wantedFeatures(preferences: Preferences | null): Set<Feature> {
  if (!preferences) return new Set();
  return new Set([
    ...preferences.interests.flatMap((interest) => INTEREST_FEATURES[interest]),
    ...(preferences.pace === 'workout' ? EXERCISE_FEATURES : []),
    ...(preferences.company === 'kids' ? (['playground'] as Feature[]) : []),
  ]);
}

const matchScore = (park: Park, wanted: Set<Feature>) =>
  park.features?.filter((feature) => wanted.has(feature)).length ?? 0;

/** The park with the most wanted features; parks are sorted by distance, so ties go to the farthest, which uses the time best. */
function preferredPark({ nearbyParks, preferences }: Conditions) {
  const wanted = wantedFeatures(preferences);
  return nearbyParks.reduce<Park | undefined>(
    (best, park) => (!best || matchScore(park, wanted) >= matchScore(best, wanted) ? park : best),
    undefined,
  );
}

/** A park that matches the answers when the model's pick is known to match none of them. */
function betterMatch(park: Park, conditions: Conditions) {
  const wanted = wantedFeatures(conditions.preferences);
  const best = preferredPark(conditions);
  const pickIsKnownMiss = park.features !== null && matchScore(park, wanted) === 0;
  return pickIsKnownMiss && best && matchScore(best, wanted) > 0 ? best : undefined;
}

export function fallbackRecommendation(conditions: Conditions): Recommendation {
  const { weather, availableMinutes, nearbyBikeStations, preferences } = conditions;
  const summary = conditionsSummary(conditions);
  const park = preferredPark(conditions);

  if (isUnsafeOutside(conditions)) {
    return {
      verdict: 'stay',
      activity: 'Open a window and stretch for 10 minutes',
      durationMin: 10,
      reason: `It's not a great time to head out (${summary}${rainNote(weather)}).`,
    };
  }

  const stationWithBikes = nearbyBikeStations?.find((station) => station.bikesAvailable > 0);
  if (stationWithBikes && preferences?.cycling !== false) {
    return {
      verdict: 'go',
      activity: `Grab a bike at ${stationWithBikes.name} and ride`,
      durationMin: availableMinutes,
      reason: `${summary}, and ${stationWithBikes.bikesAvailable} bikes are waiting ${stationWithBikes.distanceMeters}m away.`,
      bikeStationId: stationWithBikes.id,
      placeId: park?.id,
    };
  }

  return {
    verdict: 'go',
    activity: park ? `Walk to ${park.name} and back` : 'Take a walk around your neighborhood',
    durationMin: availableMinutes,
    reason: `${summary}. Good enough for a walk.`,
    placeId: park?.id,
  };
}

export function sanitize(recommendation: Recommendation, conditions: Conditions): Recommendation {
  const { nearbyBikeStations, nearbyParks, availableMinutes, weather, airQuality } = conditions;
  const chosenPark = nearbyParks.find((place) => place.id === recommendation.placeId);
  // Gemma often writes "Citizen’s Park" for "Citizen's Park".
  const modelActivity = recommendation.activity.replace(/[‘’]/g, "'");
  // The map must show the park the person reads about, even when placeId points elsewhere or is empty.
  const namedPark = nearbyParks.find((place) => modelActivity.includes(place.name));
  const modelPark = recommendation.verdict === 'go' ? (namedPark ?? chosenPark) : undefined;
  const stationExists = nearbyBikeStations?.some((station) => station.id === recommendation.bikeStationId);
  const stationAllowed = stationExists && conditions.preferences?.cycling !== false;
  // Gemma treats the answers as soft hints, so step in when it skips a park that clearly matches them.
  const matchingPark = modelPark && !stationAllowed ? betterMatch(modelPark, conditions) : undefined;
  // A park that isn't on the list (often a romanized Korean name with no placeId) can't be mapped or routed.
  const unlistedPark =
    recommendation.verdict === 'go' && !modelPark && !stationAllowed && PARK_WORDS.test(modelActivity)
      ? preferredPark(conditions)
      : undefined;
  const switchedPark = matchingPark ?? unlistedPark;
  const park = switchedPark ?? modelPark;
  const walk = park ? `Walk to ${park.name} and back` : 'Take a walk around your neighborhood';
  // Small models romanize Korean park names into places that don't exist, or leave stray syllables
  // next to the real name ("Walk to 경 경찰기념공원"), so name the real one instead.
  const strayHangul = namedPark !== undefined && HANGUL.test(modelActivity.replace(namedPark.name, ''));
  const garbledPark = park && (!namedPark || strayHangul);
  const unwantedBike = !stationAllowed && /\b(bikes?|cycl\w*|ride)\b/i.test(modelActivity);
  const activity =
    recommendation.verdict === 'go' && !stationAllowed && (switchedPark || garbledPark || unwantedBike)
      ? walk
      : modelActivity;
  // Small models write "None" or "N/A" instead of null when there is nothing to warn about.
  const safetyNote = recommendation.safetyNote?.trim();
  const hasSafetyNote = safetyNote && !/^(none|n\/a|null)\.?$/i.test(safetyNote);

  return {
    ...recommendation,
    activity,
    reason: checkReason(recommendation.reason, conditions),
    // The model's ideas were written for the park it picked, so a switched park gets ideas from its own features.
    thingsToDo:
      recommendation.verdict === 'go'
        ? checkThingsToDo(switchedPark ? null : recommendation.thingsToDo, park, conditions)
        : [],
    safetyNote: hasSafetyNote ? safetyNote : null,
    durationMin: Math.min(recommendation.durationMin, availableMinutes),
    placeId: park?.id ?? null,
    bikeStationId: stationAllowed ? recommendation.bikeStationId : null,
    outfit: recommendation.outfit
      ? withRequiredExtras(recommendation.outfit, weather, airQuality)
      : conditions.baselineOutfit,
  };
}

export async function askModel(agent: Agent, conditions: Conditions): Promise<Recommendation | null> {
  const prompt = `Current conditions:\n${JSON.stringify(conditions, null, 2)}`;

  for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt++) {
    try {
      const result = await agent.generate(prompt);
      const recommendation = parseModelOutput(result.text);
      if (recommendation) return recommendation;
      console.warn(`Model returned invalid JSON (attempt ${attempt}):`, result.text);
    } catch (error) {
      console.warn(`Model call failed (attempt ${attempt}):`, (error as Error).message);
    }
  }
  return null;
}

export type Source = 'model' | 'fallback';

export async function buildResponse(origin: LatLon, conditions: Conditions, checked: Recommendation, source: Source) {
  const { outfit, placeId, bikeStationId, ...recommendation } = checked;

  const place = conditions.nearbyParks.find((park) => park.id === placeId);
  const bikeStation = conditions.nearbyBikeStations?.find((station) => station.id === bikeStationId);
  const route: Route | null = place ? await optional(getRoundTripWalk(origin, place), 'route', null) : null;
  // The card's duration must cover the real round trip shown on the map, even when that is over the time
  // available (only when the round trip couldn't be measured before the park was chosen).
  const durationMin = route ? Math.max(recommendation.durationMin, route.durationMin) : recommendation.durationMin;

  return {
    recommendation: { ...recommendation, durationMin },
    thingScenes: (recommendation.thingsToDo ?? []).map(sceneFor),
    outfits: outfitOptions(outfit ?? conditions.baselineOutfit, conditions.weather, conditions.airQuality),
    origin,
    place: place ? { name: place.name, lat: place.lat, lon: place.lon, features: place.features } : null,
    route,
    bikeStation: bikeStation
      ? { name: bikeStation.name, lat: bikeStation.lat, lon: bikeStation.lon, bikesAvailable: bikeStation.bikesAvailable }
      : null,
    source,
    conditions: {
      isDay: conditions.weather.isDay,
      temperatureC: conditions.weather.temperatureC,
      feelsLikeC: conditions.weather.feelsLikeC,
      description: conditions.weather.description,
      sky: conditions.weather.sky,
      rainChance: conditions.weather.maxPrecipitationChanceNext3h,
      rainChanceByHour: conditions.weather.precipitationChanceByHour,
      uvIndex: conditions.weather.uvIndex,
      windKmh: conditions.weather.windKmh,
      airQuality: conditions.airQuality.level,
      airQualityIndex: conditions.airQuality.europeanAqi,
      sunset: conditions.weather.sunset,
      minutesUntilSunset: conditions.weather.minutesUntilSunset,
    },
  };
}

export type RecommendResponse = Awaited<ReturnType<typeof buildResponse>>;
