import type { Agent } from '@mastra/core/agent';
import { getAirQuality, type AirQuality } from './conditions/airQuality.js';
import { getNearbyBikeStations, type BikeStation } from './conditions/bikes.js';
import { getNearbyParks, walkableRadiusM, type Place } from './conditions/places.js';
import { getRoundTripWalk, type Route } from './conditions/route.js';
import { getWeather, type Weather } from './conditions/weather.js';
import type { LatLon } from './geo.js';
import { baselineOutfit, outfitOptions, withRequiredExtras, type Outfit } from './outfit.js';
import { recommendationSchema, type Recommendation } from './schema.js';

export interface Conditions {
  availableMinutes: number;
  weather: Weather;
  airQuality: AirQuality;
  nearbyBikeStations: BikeStation[] | null;
  nearbyParks: Place[];
  baselineOutfit: Outfit;
}

const MODEL_ATTEMPTS = 2;

function optional<T>(promise: Promise<T>, label: string, fallback: T) {
  return promise.catch((error) => {
    console.warn(`Skipping ${label}:`, (error as Error).message);
    return fallback;
  });
}

export async function getConditions(origin: LatLon, availableMinutes: number): Promise<Conditions> {
  const [weather, airQuality, nearbyBikeStations, nearbyParks] = await Promise.all([
    getWeather(origin.lat, origin.lon),
    getAirQuality(origin.lat, origin.lon),
    optional(getNearbyBikeStations(origin.lat, origin.lon), 'bike stations', null),
    optional(getNearbyParks(origin, walkableRadiusM(availableMinutes)), 'parks', []),
  ]);
  return {
    availableMinutes,
    weather,
    airQuality,
    nearbyBikeStations,
    nearbyParks,
    baselineOutfit: baselineOutfit(weather, airQuality),
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

export function fallbackRecommendation(conditions: Conditions): Recommendation {
  const { weather, airQuality, availableMinutes, nearbyBikeStations, nearbyParks } = conditions;
  const summary = `${weather.temperatureC}°C, ${weather.description}, air quality ${airQuality.level}`;
  // Parks are sorted by distance and all fit the time budget, so the farthest uses the time best.
  const park = nearbyParks.at(-1);

  if (isUnsafeOutside(conditions)) {
    return {
      verdict: 'stay',
      activity: 'Open a window and stretch for 10 minutes',
      durationMin: 10,
      reason: `It's not a great time to head out (${summary}, ${weather.maxPrecipitationChanceNext3h}% chance of rain).`,
    };
  }

  const stationWithBikes = nearbyBikeStations?.find((station) => station.bikesAvailable > 0);
  if (stationWithBikes && availableMinutes >= 30) {
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
  const placeExists = nearbyParks.some((place) => place.id === recommendation.placeId);
  // The model sometimes names a park in the activity but leaves placeId empty.
  const namedPark = nearbyParks.find((place) => recommendation.activity.includes(place.name));
  const placeId = placeExists ? recommendation.placeId : namedPark?.id;
  const stationExists = nearbyBikeStations?.some((station) => station.id === recommendation.bikeStationId);
  // Small models write "None" or "N/A" instead of null when there is nothing to warn about.
  const safetyNote = recommendation.safetyNote?.trim();
  const hasSafetyNote = safetyNote && !/^(none|n\/a|null)\.?$/i.test(safetyNote);

  return {
    ...recommendation,
    safetyNote: hasSafetyNote ? safetyNote : null,
    durationMin: Math.min(recommendation.durationMin, availableMinutes),
    placeId: recommendation.verdict === 'go' ? (placeId ?? null) : null,
    bikeStationId: stationExists ? recommendation.bikeStationId : null,
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
      temperatureC: conditions.weather.temperatureC,
      feelsLikeC: conditions.weather.feelsLikeC,
      description: conditions.weather.description,
      rainChance: conditions.weather.maxPrecipitationChanceNext3h,
      uvIndex: conditions.weather.uvIndex,
      airQuality: conditions.airQuality.level,
      sunset: conditions.weather.sunset,
    },
  };
}

export type RecommendResponse = Awaited<ReturnType<typeof buildResponse>>;
