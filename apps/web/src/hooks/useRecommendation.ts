import { useState } from 'react';
import { fetchRecommendation } from '../services/api';
import { geocodeCity, getCurrentPosition, locationErrorMessage } from '../services/location';
import type { PlaceKind, PlaceSearch, RecommendResponse } from '../types/api';
import type { Visit } from '../types/explore';
import type { RecentPlace, SearchOrigin } from '../types/places';
import type { Preferences } from '../types/preferences';
import { exploredNear } from '../utils/explore';

/** One search from a starting point, and the places suggested from it so far. */
export interface PlaceSession {
  origin: SearchOrigin;
  /** Names of the places already suggested, so asking again finds new ones. */
  seen: string[];
  lastKind: PlaceKind | null;
}

export type RecommendStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | {
      kind: 'done';
      result: RecommendResponse;
      session: PlaceSession;
      /** True while another place is being looked up; the current one stays on screen. */
      finding: boolean;
      notice: string | null;
    }
  | { kind: 'error'; message: string };

const HERE_LABEL = 'your location';

/**
 * Finds where the person is (or looks up a city), asks the server for a suggestion, and can then ask for another
 * place from the same start. Every suggested place goes to onPlace, which keeps the recent places. Places the person
 * explored around the start go with each request, so somewhere new comes first.
 */
export function useRecommendation(
  availableMinutes: number,
  preferences: Preferences | null,
  onPlace: (place: RecentPlace) => void,
  visits: Visit[],
) {
  const [status, setStatus] = useState<RecommendStatus>({ kind: 'idle' });

  /** The session after a result, recording its place both here and in the recent places. */
  function remember(result: RecommendResponse, session: PlaceSession): PlaceSession {
    const { place, route } = result;
    if (!place) return session;
    const { features: _features, explored: _explored, ...details } = place;
    const arrival = route ? { lat: route.destinationOnPath[0], lon: route.destinationOnPath[1] } : undefined;
    onPlace({
      ...details,
      city: place.city ?? session.origin.city,
      origin: session.origin,
      byBike: route?.mode === 'bike',
      arrival,
      thingsToDo: result.recommendation.thingsToDo,
      viewedAt: Date.now(),
    });
    return { ...session, seen: [...session.seen, place.name], lastKind: place.kind };
  }

  async function start(origin: SearchOrigin, search: PlaceSearch = {}) {
    setStatus({
      kind: 'loading',
      message: preferences?.cycling
        ? 'Checking the sky, the air, and nearby bikes…'
        : 'Checking the sky, the air, and nearby places…',
    });
    try {
      const result = await fetchRecommendation(origin, availableMinutes, preferences, {
        ...search,
        exploredPlaces: exploredNear(visits, origin),
      });
      const session = remember(result, { origin, seen: [], lastKind: null });
      setStatus({ kind: 'done', result, session, finding: false, notice: null });
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  }

  async function recommendHere() {
    setStatus({ kind: 'loading', message: 'Finding where you are…' });
    try {
      const { coords } = await getCurrentPosition();
      await start({ lat: coords.latitude, lon: coords.longitude, label: HERE_LABEL, city: null });
    } catch (error) {
      setStatus({ kind: 'error', message: locationErrorMessage(error) });
    }
  }

  async function recommendInCity(city: string) {
    setStatus({ kind: 'loading', message: `Looking up ${city}…` });
    try {
      const { lat, lon, name } = await geocodeCity(city.trim());
      await start({ lat, lon, label: name, city: name });
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  }

  /** Suggests a recent place again, from where its walk started then. */
  function recommendRecent(place: RecentPlace) {
    const { name, kind, city, area, lat, lon, byBike } = place;
    return start(place.origin, { place: { name, kind, city, area, lat, lon, byBike } });
  }

  /** Another place from the same start, skipping the ones already suggested; the current one stays if none is left. */
  async function anotherPlace() {
    if (status.kind !== 'done' || status.finding) return;
    const { result: current, session } = status;
    setStatus({ ...status, finding: true, notice: null });
    const keepCurrent = (notice: string) =>
      setStatus({ kind: 'done', result: current, session, finding: false, notice });
    try {
      const result = await fetchRecommendation(session.origin, availableMinutes, preferences, {
        excludePlaces: session.seen,
        varyFrom: session.lastKind,
        exploredPlaces: exploredNear(visits, session.origin),
      });
      if (result.recommendation.verdict === 'go' && !result.place) {
        keepCurrent(
          `No other places fit in ${availableMinutes} minutes around ${session.origin.label}. Try more time to reach farther ones.`,
        );
        return;
      }
      setStatus({ kind: 'done', result, session: remember(result, session), finding: false, notice: null });
    } catch (error) {
      keepCurrent((error as Error).message);
    }
  }

  return {
    status,
    recommendHere,
    recommendInCity,
    recommendRecent,
    anotherPlace,
    reset: () => setStatus({ kind: 'idle' }),
  };
}
