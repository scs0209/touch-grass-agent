import type { PlaceSearch, RecommendResponse, TripPhotos } from '../types/api';
import type { LatLon } from '../types/geo';
import type { Preferences } from '../types/preferences';

export async function fetchRecommendation(
  { lat, lon }: LatLon,
  availableMinutes: number,
  preferences: Preferences | null,
  search: PlaceSearch = {},
) {
  const response = await fetch('/api/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lon, availableMinutes, preferences, ...search }),
  });
  const body = await response.json();
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
