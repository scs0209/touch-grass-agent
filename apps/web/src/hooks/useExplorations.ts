import { useCallback, useState } from 'react';
import { addVisit, loadVisits } from '../services/explorations';
import { checkInErrorMessage, getCurrentPosition } from '../services/location';
import type { Visit } from '../types/explore';
import type { RecentPlace } from '../types/places';
import { type ArrivalSummary, arrivalSummary, checkInCandidates, isThere, nearestCandidate } from '../utils/explore';

export type CheckInStatus =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'far'; place: RecentPlace; distanceM: number }
  | { kind: 'error'; message: string }
  | { kind: 'arrived'; place: RecentPlace; summary: ArrivalSummary };

/**
 * Places the person checked in at, kept in this browser. A check-in compares a fresh location with today's
 * suggestions on the device; the location itself is neither sent nor saved, only the place it matched.
 */
export function useExplorations(recentPlaces: RecentPlace[]) {
  const [visits, setVisits] = useState<Visit[]>(loadVisits);
  const [checkIn, setCheckIn] = useState<CheckInStatus>({ kind: 'idle' });
  const candidates = checkInCandidates(recentPlaces, visits);

  async function checkInHere() {
    if (candidates.length === 0 || checkIn.kind === 'locating') return;
    setCheckIn({ kind: 'locating' });
    try {
      const { coords } = await getCurrentPosition({ maximumAgeMs: 0, precise: true });
      const nearest = nearestCandidate({ lat: coords.latitude, lon: coords.longitude }, candidates);
      if (!nearest) return setCheckIn({ kind: 'idle' });
      if (!isThere(nearest.distanceM, coords.accuracy)) return setCheckIn({ kind: 'far', ...nearest });
      const { name, kind, city, area, lat, lon } = nearest.place;
      const visit: Visit = { name, kind, city, area, lat, lon, at: Date.now() };
      setCheckIn({ kind: 'arrived', place: nearest.place, summary: arrivalSummary(visits, visit) });
      setVisits((current) => addVisit(current, visit));
    } catch (error) {
      setCheckIn({ kind: 'error', message: checkInErrorMessage(error) });
    }
  }

  const dismiss = useCallback(() => setCheckIn({ kind: 'idle' }), []);

  return { visits, candidates, checkIn, checkInHere, dismiss };
}
