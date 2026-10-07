import { messages } from '../i18n';
import type { RecommendResponse } from '../types/api';
import type { Outfit } from '../types/outfit';
import type { StoryInput } from '../types/preview';
import { outfitItems } from './outfit';

/** The line under the map, e.g. "1.3 km round trip to X · about 18 min on foot". */
export function describeRoute({ route, place, bikeStation }: RecommendResponse) {
  if (!route || !place) return null;
  const t = messages().result;
  const km = (route.distanceM / 1000).toFixed(1);
  if (route.mode !== 'bike') return t.routeWalk(km, place.name, route.durationMin);
  const station = bikeStation?.name ?? t.theStation;
  return t.routeBike(km, place.name, route.durationMin, route.rideMin, station, route.walkMin);
}

export function storyInput(
  result: RecommendResponse,
  place: NonNullable<RecommendResponse['place']>,
  outfit: Outfit,
  discovery: string | null,
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
    discovery,
  };
}
