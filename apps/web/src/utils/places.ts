import { messages } from '../i18n';
import type { NamedPoint } from '../types/geo';
import type { RecentPlace, SearchOrigin } from '../types/places';
import { distanceM } from './geo';

/** Nominatim can place the same park a few meters apart between searches. */
const SAME_PLACE_M = 150;
/** Saved with recent places as the label of a search from the person's location; shown in the current language. */
export const HERE_LABEL = 'your location';

export const isSamePlace = (a: NamedPoint, b: NamedPoint) => a.name === b.name && distanceM(a, b) < SAME_PLACE_M;

export function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

export const originLabel = ({ label }: Pick<SearchOrigin, 'label'>) =>
  label === HERE_LABEL ? messages().hereLabel : label;

/** Where a place is, e.g. "Jongno-gu, Seoul". */
export function placeArea({ area, city }: { area: string | null; city: string | null }) {
  return [area, city].filter(Boolean).join(', ');
}

/** The line under a recent place, e.g. "Landmark · Jongno-gu, Seoul · 1.4 km from Seoul". */
export function describeRecentPlace(place: RecentPlace) {
  const t = messages().places;
  const from = t.from(formatDistance(distanceM(place.origin, place)), originLabel(place.origin));
  return [t.kind[place.kind], placeArea(place), from].filter(Boolean).join(' · ');
}
