import type { PlaceKind } from '../types/api';
import type { NamedPoint } from '../types/geo';
import type { RecentPlace } from '../types/places';
import { distanceM } from './geo';

export const PLACE_KIND_LABEL: Record<PlaceKind, string> = { park: 'Park', landmark: 'Landmark' };

/** Nominatim can place the same park a few meters apart between searches. */
const SAME_PLACE_M = 150;

export const isSamePlace = (a: NamedPoint, b: NamedPoint) => a.name === b.name && distanceM(a, b) < SAME_PLACE_M;

export function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Where a place is, e.g. "Jongno-gu, Seoul". */
export function placeArea({ area, city }: { area: string | null; city: string | null }) {
  return [area, city].filter(Boolean).join(', ');
}

/** The line under a recent place, e.g. "Landmark · Jongno-gu, Seoul · 1.4 km from Seoul". */
export function describeRecentPlace(place: RecentPlace) {
  const from = `${formatDistance(distanceM(place.origin, place))} from ${place.origin.label}`;
  return [PLACE_KIND_LABEL[place.kind], placeArea(place), from].filter(Boolean).join(' · ');
}
