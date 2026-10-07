import { currentLanguage, messages } from '../i18n';
import type { PlaceSearch, RecommendResponse, TripPhotos } from '../types/api';
import type { LatLon } from '../types/geo';
import type { Preferences } from '../types/preferences';

/** Longer than Gemma's first load, its answer, and its translation, so only an unreachable server hits it. */
const RECOMMEND_TIMEOUT_MS = 90_000;
const GEOCODE_TIMEOUT_MS = 10_000;

export async function fetchRecommendation(
  { lat, lon }: LatLon,
  availableMinutes: number,
  preferences: Preferences | null,
  search: PlaceSearch = {},
) {
  const t = messages().errors;
  let response: Response;
  try {
    response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon, availableMinutes, preferences, language: currentLanguage(), ...search }),
      signal: AbortSignal.timeout(RECOMMEND_TIMEOUT_MS),
    });
  } catch {
    throw new Error(t.unreachable);
  }
  // A proxy in front of a stopped server answers with an HTML error page.
  const body = await response.json().catch(() => null);
  if (!body) throw new Error(t.unreachable);
  if (response.status === 400) throw new Error(t.invalidRequest);
  if (!response.ok) throw new Error(t.server);
  return body as RecommendResponse;
}

/** A city's center from the server's Nominatim lookup; null when it isn't found or the server can't be reached. */
export async function geocodeOnServer(name: string): Promise<LatLon | null> {
  try {
    const response = await fetch(`/api/geocode?name=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as LatLon;
  } catch {
    return null;
  }
}

interface TripPhotosRequest {
  /** Where the route reaches the park. */
  entrance: LatLon;
  destination: LatLon;
  placeName: string;
}

/** Null when the server finds no photos or answers with an error. */
export async function fetchTripPhotos(request: TripPhotosRequest, signal: AbortSignal): Promise<TripPhotos | null> {
  const response = await fetch('/api/trip-photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) return null;
  return ((await response.json()) as { photos: TripPhotos | null }).photos;
}

export const tripPhotoUrl = (key: string) => `/api/trip-photos/${key}`;
