import { useState } from 'react';
import { fetchRecommendation } from '../services/api';
import { geocodeCity, getCurrentPosition, locationErrorMessage } from '../services/location';
import type { RecommendResponse } from '../types/api';
import type { Preferences } from '../types/preferences';

export type RecommendStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'done'; result: RecommendResponse }
  | { kind: 'error'; message: string };

/** Finds where the person is (or looks up a city), then asks the server for a suggestion. */
export function useRecommendation(availableMinutes: number, preferences: Preferences | null) {
  const [status, setStatus] = useState<RecommendStatus>({ kind: 'idle' });

  async function recommendFor(lat: number, lon: number) {
    setStatus({
      kind: 'loading',
      message: preferences?.cycling ? 'Checking the sky, the air, and nearby bikes…' : 'Checking the sky, the air, and nearby parks…',
    });
    try {
      setStatus({ kind: 'done', result: await fetchRecommendation(lat, lon, availableMinutes, preferences) });
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  }

  async function recommendHere() {
    setStatus({ kind: 'loading', message: 'Finding where you are…' });
    try {
      const { coords } = await getCurrentPosition();
      await recommendFor(coords.latitude, coords.longitude);
    } catch (error) {
      setStatus({ kind: 'error', message: locationErrorMessage(error) });
    }
  }

  async function recommendInCity(city: string) {
    setStatus({ kind: 'loading', message: `Looking up ${city}…` });
    try {
      const { lat, lon } = await geocodeCity(city.trim());
      await recommendFor(lat, lon);
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  }

  return { status, recommendHere, recommendInCity, reset: () => setStatus({ kind: 'idle' }) };
}
