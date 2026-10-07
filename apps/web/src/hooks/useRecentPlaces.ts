import { useCallback, useState } from 'react';
import { addRecentPlace, loadRecentPlaces, removeRecentPlace } from '../services/recentPlaces';
import type { RecentPlace } from '../types/places';

/** Places suggested before, newest first, kept in this browser. */
export function useRecentPlaces() {
  const [places, setPlaces] = useState<RecentPlace[]>(loadRecentPlaces);
  const add = useCallback((place: RecentPlace) => setPlaces((current) => addRecentPlace(current, place)), []);
  const remove = useCallback((place: RecentPlace) => setPlaces((current) => removeRecentPlace(current, place)), []);
  return { places, add, remove };
}
