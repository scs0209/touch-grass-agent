import type { PlaceSearch, RecommendResponse, TripPhotos } from '../types/api';
import type { LatLon } from '../types/geo';
import type { Preferences } from '../types/preferences';

/** Longer than Gemma's first load plus the slowest upstream lookup, so only an unreachable server hits it. */
const RECOMMEND_TIMEOUT_MS = 90_000;

const UNREACHABLE =
  "Couldn't reach the app's server. On your phone, check that the Mac is awake and online. Checking in still works offline.";

export async function fetchRecommendation(
  { lat, lon }: LatLon,
  availableMinutes: number,
  preferences: Preferences | null,
  search: PlaceSearch = {},
) {
  let response: Response;
  try {
    response = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon, availableMinutes, preferences, ...search }),
      signal: AbortSignal.timeout(RECOMMEND_TIMEOUT_MS),
    });
  } catch {
    throw new Error(UNREACHABLE);
  }
  // A proxy in front of a stopped server answers with an HTML error page.
  const body = await response.json().catch(() => null);
  if (!body) throw new Error(UNREACHABLE);
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong.');
  return body as RecommendResponse;
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
