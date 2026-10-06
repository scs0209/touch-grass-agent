import { setTimeout as sleep } from 'node:timers/promises';
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
/** Ddareungi riders in the city average about 9–12 km/h; the measured bike trip decides in the end. */
const RIDING_METERS_PER_MIN = 200;
/** Walking to the station and home from it, plus renting and returning the bike. */
const BIKE_OVERHEAD_MIN = 10;
/** Walking paths are rarely straight; road distance is typically ~1.3x the straight line. */
const DETOUR_FACTOR = 1.3;
/** Places closer than this share of the radius barely use the time, so they are skipped when others exist. */
const MIN_DISTANCE_RATIO = 0.3;
const MAX_PLACES = 6;
/** Nominatim's usage policy allows at most one request per second. */
const NOMINATIM_GAP_MS = 1000;

let nextNominatimAt = 0;

async function waitForNominatim() {
  const now = Date.now();
  const startAt = Math.max(now, nextNominatimAt);
  nextNominatimAt = startAt + NOMINATIM_GAP_MS;
  if (startAt > now) await sleep(startAt - now);
}

/** Straight-line radius reachable on a round trip within the available time. */
export function walkableRadiusM(availableMinutes: number) {
  return Math.round(((availableMinutes / 2) * WALKING_METERS_PER_MIN) / DETOUR_FACTOR);
}

/** Straight-line radius reachable on a Ddareungi round trip from a nearby station. */
export function rideableRadiusM(availableMinutes: number) {
  return Math.round((((availableMinutes - BIKE_OVERHEAD_MIN) / 2) * RIDING_METERS_PER_MIN) / DETOUR_FACTOR);
}

/** Parks within radiusM, skipping those within beyondM; ids start with idPrefix so lists can be combined. */
export async function getNearbyParks(
  origin: LatLon,
  radiusM: number,
  { beyondM = 0, idPrefix = 'P' }: { beyondM?: number; idPrefix?: string } = {},
): Promise<Place[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: 'park',
    viewbox: viewboxAround(origin, radiusM),
    bounded: '1',
    format: 'jsonv2',
    limit: '15',
  }).toString();

  await waitForNominatim();
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
    .filter((place) => place.distanceMeters <= radiusM && place.distanceMeters > beyondM);
  const worthTheWalk = reachable.filter((place) => place.distanceMeters >= radiusM * MIN_DISTANCE_RATIO);

  return (worthTheWalk.length > 0 ? worthTheWalk : reachable)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_PLACES)
    .map((place, index) => ({ id: `${idPrefix}${index + 1}`, ...place }));
}
