import { distanceInMeters, viewboxAround, type LatLon } from '../geo.js';

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceMeters: number;
}

interface NominatimResult {
  name: string;
  lat: string;
  lon: string;
}

const WALKING_METERS_PER_MIN = 80;
/** Walking paths are rarely straight; road distance is typically ~1.3x the straight line. */
const DETOUR_FACTOR = 1.3;
/** Places closer than this share of the radius barely use the time, so they are skipped when others exist. */
const MIN_DISTANCE_RATIO = 0.3;
const MAX_PLACES = 6;

/** Straight-line radius reachable on a round trip within the available time. */
export function walkableRadiusM(availableMinutes: number) {
  return Math.round(((availableMinutes / 2) * WALKING_METERS_PER_MIN) / DETOUR_FACTOR);
}

export async function getNearbyParks(origin: LatLon, radiusM: number): Promise<Place[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: 'park',
    viewbox: viewboxAround(origin, radiusM),
    bounded: '1',
    format: 'jsonv2',
    limit: '15',
  }).toString();

  // Nominatim's usage policy requires an identifying User-Agent.
  const response = await fetch(url, {
    headers: { 'User-Agent': 'touch-grass-agent/0.1', 'Accept-Language': 'en,ko' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Nominatim failed: ${response.status}`);
  const results = (await response.json()) as NominatimResult[];

  const seenNames = new Set<string>();
  const reachable = results
    .filter((result) => result.name && !seenNames.has(result.name) && seenNames.add(result.name))
    .map((result) => {
      const position = { lat: Number(result.lat), lon: Number(result.lon) };
      return { name: result.name, ...position, distanceMeters: Math.round(distanceInMeters(origin, position)) };
    })
    .filter((place) => place.distanceMeters <= radiusM);
  const worthTheWalk = reachable.filter((place) => place.distanceMeters >= radiusM * MIN_DISTANCE_RATIO);

  return (worthTheWalk.length > 0 ? worthTheWalk : reachable)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_PLACES)
    .map((place, index) => ({ id: `P${index + 1}`, ...place }));
}
