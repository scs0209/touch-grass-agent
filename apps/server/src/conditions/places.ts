import { setTimeout as sleep } from 'node:timers/promises';
import { distanceInMeters, type LatLon, viewboxAround } from '../geo.js';

export type PlaceKind = 'park' | 'landmark';

export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  distanceMeters: number;
  /** City, town, or county from OpenStreetMap's address; null when it has none. */
  city: string | null;
  /** District or neighborhood within the city, e.g. "Jongno-gu". */
  area: string | null;
}

interface NominatimResult {
  name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
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
/** Asking for another place repeats the same search; parks and sights don't move in half an hour. */
const SEARCH_CACHE_MS = 30 * 60 * 1000;

/** Nominatim's search phrase for each kind of place. */
const SEARCH_PHRASE: Record<PlaceKind, string> = { park: 'park', landmark: 'attraction' };
/** Most attractions in OpenStreetMap are signs, murals, and shop corners; landmarks need far more results to pick from. */
const SEARCH_LIMIT: Record<PlaceKind, number> = { park: 15, landmark: 40 };
/** Attractions that are indoors, where the app can't send someone for some fresh air. */
const INDOOR_WORDS = /\b(museum|mall|shopping|underground|station|gallery|greenhouse)\b/i;

let nextNominatimAt = 0;
const searches = new Map<string, { results: Promise<NominatimResult[]>; expiresAt: number }>();

async function waitForNominatim() {
  const now = Date.now();
  const startAt = Math.max(now, nextNominatimAt);
  nextNominatimAt = startAt + NOMINATIM_GAP_MS;
  if (startAt > now) await sleep(startAt - now);
}

async function fetchNominatim(url: URL): Promise<NominatimResult[]> {
  await waitForNominatim();
  // Nominatim's usage policy requires an identifying User-Agent.
  const response = await fetch(url, {
    headers: { 'User-Agent': 'touch-grass-agent/0.1', 'Accept-Language': 'en,ko' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Nominatim failed: ${response.status}`);
  return (await response.json()) as NominatimResult[];
}

function searchNominatim(url: URL) {
  const now = Date.now();
  for (const [key, entry] of searches) if (entry.expiresAt <= now) searches.delete(key);
  const key = url.toString();
  const cached = searches.get(key);
  if (cached) return cached.results;
  const results = fetchNominatim(url);
  searches.set(key, { results, expiresAt: now + SEARCH_CACHE_MS });
  // Forget failures so the next request asks Nominatim again.
  results.catch(() => {
    if (searches.get(key)?.results === results) searches.delete(key);
  });
  return results;
}

const cityOf = (address: Record<string, string> = {}) =>
  address.city ?? address.town ?? address.village ?? address.county ?? address.state ?? null;
const areaOf = (address: Record<string, string> = {}) =>
  address.borough ?? address.city_district ?? address.suburb ?? address.quarter ?? null;

/** A Wikidata entry marks a sight people know, rather than a mural or a shop sign tagged as an attraction. */
const isLandmark = (result: NominatimResult) =>
  Boolean(result.extratags?.wikidata) && result.extratags?.indoor !== 'yes' && !INDOOR_WORDS.test(result.name);

/** Straight-line radius reachable on a round trip within the available time. */
export function walkableRadiusM(availableMinutes: number) {
  return Math.round(((availableMinutes / 2) * WALKING_METERS_PER_MIN) / DETOUR_FACTOR);
}

/** Straight-line radius reachable on a Ddareungi round trip from a nearby station. */
export function rideableRadiusM(availableMinutes: number) {
  return Math.round((((availableMinutes - BIKE_OVERHEAD_MIN) / 2) * RIDING_METERS_PER_MIN) / DETOUR_FACTOR);
}

/**
 * Parks (or landmarks) within radiusM, skipping those within beyondM and those named in exclude;
 * ids start with idPrefix so lists can be combined.
 */
export async function getNearbyPlaces(
  origin: LatLon,
  radiusM: number,
  {
    kind = 'park',
    beyondM = 0,
    idPrefix = 'P',
    exclude = [],
  }: { kind?: PlaceKind; beyondM?: number; idPrefix?: string; exclude?: string[] } = {},
): Promise<Place[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: SEARCH_PHRASE[kind],
    viewbox: viewboxAround(origin, radiusM),
    bounded: '1',
    format: 'jsonv2',
    limit: String(SEARCH_LIMIT[kind]),
    addressdetails: '1',
    extratags: kind === 'landmark' ? '1' : '0',
  }).toString();
  const results = await searchNominatim(url);

  const skipped = new Set(exclude);
  const seenNames = new Set<string>();
  const reachable = results
    .filter((result) => kind === 'park' || isLandmark(result))
    .filter(
      (result) => result.name && !skipped.has(result.name) && !seenNames.has(result.name) && seenNames.add(result.name),
    )
    .map((result) => {
      const position = { lat: Number(result.lat), lon: Number(result.lon) };
      return {
        name: result.name,
        kind,
        ...position,
        distanceMeters: Math.round(distanceInMeters(origin, position)),
        city: cityOf(result.address),
        area: areaOf(result.address),
      };
    })
    .filter((place) => place.distanceMeters <= radiusM && place.distanceMeters > beyondM);
  const worthTheWalk = reachable.filter((place) => place.distanceMeters >= radiusM * MIN_DISTANCE_RATIO);

  return (worthTheWalk.length > 0 ? worthTheWalk : reachable)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_PLACES)
    .map((place, index) => ({ id: `${idPrefix}${index + 1}`, ...place }));
}
