import type { RecommendResponse } from '../types/api';
import type { Outfit } from '../types/outfit';
import type { StoryInput } from '../types/preview';
import { outfitItems } from './outfit';

/** The line under the map, e.g. "1.3 km round trip to X · about 18 min on foot". */
export function describeRoute({ route, place, bikeStation }: RecommendResponse) {
  if (!route || !place) return null;
  const trip = `${(route.distanceM / 1000).toFixed(1)} km round trip to ${place.name} · about ${route.durationMin} min`;
  if (route.mode !== 'bike') return `${trip} on foot`;
  const station = bikeStation?.name ?? 'the station';
  return `${trip} (${route.rideMin} by bike from ${station}, ${route.walkMin} on foot)`;
}

export function storyInput(
  result: RecommendResponse,
  place: NonNullable<RecommendResponse['place']>,
  outfit: Outfit,
): StoryInput {
  const { recommendation, thingScenes, origin, route, bikeStation, conditions } = result;
  return {
    durationMin: recommendation.durationMin,
    placeName: place.name,
    features: place.features ?? [],
    origin,
    destination: place,
    route,
    bikeStation,
    things: recommendation.thingsToDo.map((text, i) => ({ text, scene: thingScenes[i] ?? 'walk' })),
    outfitItems: outfitItems(outfit),
    conditions,
  };
}
