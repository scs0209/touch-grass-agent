import { setTimeout as sleep } from 'node:timers/promises';
import type { Agent } from '@mastra/core/agent';
import { getAirQuality, type AirQuality } from './conditions/airQuality.js';
import { getNearbyBikeStations, type BikeStation } from './conditions/bikes.js';
import { getParkFeatures, type Feature } from './conditions/features.js';
import { getNearbyParks, walkableRadiusM, type Place } from './conditions/places.js';
import { getRoundTripWalk, prefetchRoundTripWalks, type Route } from './conditions/route.js';
import { getWeather, type Weather } from './conditions/weather.js';
import type { LatLon } from './geo.js';
import { baselineOutfit, outfitOptions, withRequiredExtras, type Outfit } from './outfit.js';
import { recommendationSchema, type Interest, type Preferences, type Recommendation } from './schema.js';

export interface Park extends Place {
  /** What OpenStreetMap shows around the park; null when it couldn't be checked in time. */
  features: Feature[] | null;
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
/** Overpass usually answers in about 3 s; past that the model plans without features. */
const FEATURES_WAIT_MS = 3000;
const MAX_THINGS_TO_DO = 3;

function optional<T>(promise: Promise<T>, label: string, fallback: T) {
  return promise.catch((error) => {
    console.warn(`Skipping ${label}:`, (error as Error).message);
    return fallback;
  });
}

/** A slow answer still lands in the features cache, so asking again from the same spot gets it. */
async function withFeatures(parks: Place[]): Promise<Park[]> {
  if (parks.length === 0) return [];
  const features = Promise.all(getParkFeatures(parks));
  const lists = await optional(Promise.race([features, sleep(FEATURES_WAIT_MS, 'late' as const)]), 'park features', null);
  if (lists === 'late') console.warn(`Skipping park features: no answer within ${FEATURES_WAIT_MS} ms`);
  const ready = Array.isArray(lists) ? lists : null;
  return parks.map((park, index) => ({ ...park, features: ready?.[index] ?? null }));
}

export async function getConditions(
  origin: LatLon,
  availableMinutes: number,
  preferences: Preferences | null,
): Promise<Conditions> {
  const [weather, airQuality, nearbyBikeStations, nearbyParks] = await Promise.all([
    getWeather(origin.lat, origin.lon),
    getAirQuality(origin.lat, origin.lon),
    optional(getNearbyBikeStations(origin.lat, origin.lon), 'bike stations', null),
    optional(getNearbyParks(origin, walkableRadiusM(availableMinutes)), 'parks', []).then(withFeatures),
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

/** The reason should only cite conditions; a park named there may be garbled or differ from the map. */
function withoutPlaceNames(reason: string, conditions: Conditions) {
  const sentences = reason
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence && !PLACE_WORDS.test(sentence) && !namesAPlace(sentence, conditions));
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
      reason: `It's not a great time to head out (${summary}, ${weather.maxPrecipitationChanceNext3h}% chance of rain).`,
    };
  }

  const stationWithBikes = nearbyBikeStations?.find((station) => station.bikesAvailable > 0);
  if (stationWithBikes && availableMinutes >= 30 && preferences?.cycling !== false) {
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
  // The map must show the park the person reads about, even when placeId points elsewhere or is empty.
  const namedPark = nearbyParks.find((place) => recommendation.activity.includes(place.name));
  const modelPark = recommendation.verdict === 'go' ? (namedPark ?? chosenPark) : undefined;
  const stationExists = nearbyBikeStations?.some((station) => station.id === recommendation.bikeStationId);
  const stationAllowed = stationExists && conditions.preferences?.cycling !== false;
  // Gemma treats the answers as soft hints, so step in when it skips a park that clearly matches them.
  const matchingPark = modelPark && !stationAllowed ? betterMatch(modelPark, conditions) : undefined;
  const park = matchingPark ?? modelPark;
  const walk = park ? `Walk to ${park.name} and back` : 'Take a walk around your neighborhood';
  // Small models romanize Korean park names into places that don't exist, so name the real one instead.
  const garbledPark = park && !namedPark;
  const unwantedBike = !stationAllowed && /\b(bikes?|cycl\w*|ride)\b/i.test(recommendation.activity);
  const activity =
    recommendation.verdict === 'go' && !stationAllowed && (matchingPark || garbledPark || unwantedBike)
      ? walk
      : recommendation.activity;
  // Small models write "None" or "N/A" instead of null when there is nothing to warn about.
  const safetyNote = recommendation.safetyNote?.trim();
  const hasSafetyNote = safetyNote && !/^(none|n\/a|null)\.?$/i.test(safetyNote);

  return {
    ...recommendation,
    activity,
    reason: withoutPlaceNames(recommendation.reason, conditions),
    // The model's ideas were written for the park it picked, so a switched park gets ideas from its own features.
    thingsToDo:
      recommendation.verdict === 'go'
        ? checkThingsToDo(matchingPark ? null : recommendation.thingsToDo, park, conditions)
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

/** Routes to every candidate park, fetched while the model is still choosing so plan-route rarely waits. */
export function prefetchRoutes(origin: LatLon, conditions: Conditions) {
  if (!isUnsafeOutside(conditions)) prefetchRoundTripWalks(origin, conditions.nearbyParks);
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
  const { availableMinutes } = conditions;
  const { outfit, placeId, bikeStationId, ...recommendation } = checked;

  const place = conditions.nearbyParks.find((park) => park.id === placeId);
  const bikeStation = conditions.nearbyBikeStations?.find((station) => station.id === bikeStationId);
  const route: Route | null = place ? await optional(getRoundTripWalk(origin, place), 'route', null) : null;
  // The card's duration must cover the real round trip shown on the map.
  const durationMin = route
    ? Math.min(Math.max(recommendation.durationMin, route.durationMin), availableMinutes)
    : recommendation.durationMin;

  return {
    recommendation: { ...recommendation, durationMin },
    outfits: outfitOptions(outfit ?? conditions.baselineOutfit, conditions.weather, conditions.airQuality),
    origin,
    place: place ? { name: place.name, lat: place.lat, lon: place.lon } : null,
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
