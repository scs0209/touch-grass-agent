import type { RecentPlace } from '../types/places';
import { distanceM } from '../utils/geo';

const STORAGE_KEY = 'touch-grass-recent-places';
const MAX_RECENT_PLACES = 10;
/** Nominatim can place the same park a few meters apart between searches. */
const SAME_PLACE_M = 150;

export const isSamePlace = (a: RecentPlace, b: RecentPlace) => a.name === b.name && distanceM(a, b) < SAME_PLACE_M;

const isRecentPlace = (value: unknown): value is RecentPlace => {
  const place = value as RecentPlace;
  return (
    typeof place?.name === 'string' &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lon) &&
    Number.isFinite(place.origin?.lat) &&
    Number.isFinite(place.origin?.lon) &&
    typeof place.origin?.label === 'string'
  );
};

/** Newest first. */
export function loadRecentPlaces(): RecentPlace[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter(isRecentPlace) : [];
  } catch {
    return [];
  }
}

function save(places: RecentPlace[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
  } catch {
    // Private browsing or a full storage keeps the list for this visit only.
  }
}

/** Moves a place suggested again to the top instead of listing it twice. */
export function addRecentPlace(places: RecentPlace[], place: RecentPlace) {
  const next = [place, ...places.filter((saved) => !isSamePlace(saved, place))].slice(0, MAX_RECENT_PLACES);
  save(next);
  return next;
}

export function removeRecentPlace(places: RecentPlace[], place: RecentPlace) {
  const next = places.filter((saved) => !isSamePlace(saved, place));
  save(next);
  return next;
}
