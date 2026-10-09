import { setTimeout as sleep } from 'node:timers/promises';
import { createCache } from '../cache.js';
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
  /** The place's outline in OpenStreetMap; null when it is mapped as a single point. */
  outline: OsmOutline | null;
}

export interface OsmOutline {
  type: 'way' | 'relation';
  id: number;
}

interface NominatimResult {
  name: string;
  lat: string;
  lon: string;
  osm_type?: string;
  osm_id?: number;
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
}

const outlineOf = ({ osm_type, osm_id }: NominatimResult): OsmOutline | null =>
  (osm_type === 'way' || osm_type === 'relation') && osm_id ? { type: osm_type, id: osm_id } : null;

/** [lon, lat] pairs, as in GeoJSON. */
export type Ring = [number, number][];

interface NominatimLookup {
  osm_type: string;
  osm_id: number;
  geojson?: { type: string; coordinates: unknown };
}

const lookupKey = (type: string, id: number) => `${type === 'way' ? 'W' : 'R'}${id}`;
export const outlineKey = ({ type, id }: OsmOutline) => lookupKey(type, id);

function ringsOf(geojson: NominatimLookup['geojson']): Ring[] | null {
  if (geojson?.type === 'Polygon') return geojson.coordinates as Ring[];
  if (geojson?.type === 'MultiPolygon') return (geojson.coordinates as Ring[][]).flat();
  return null;
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
/**
 * Asking for another place, or searching the same city later that day, repeats the same search; parks and
 * sights don't move in a day, and Nominatim's usage policy asks clients to cache.
 */
const SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;

/** Nominatim's search phrase for each kind of place. */
const SEARCH_PHRASE: Record<PlaceKind, string> = { park: 'park', landmark: 'attraction' };
/** Most attractions in OpenStreetMap are signs, murals, and shop corners; landmarks need far more results to pick from. */
const SEARCH_LIMIT: Record<PlaceKind, number> = { park: 15, landmark: 40 };
/** Attractions that are indoors, where the app can't send someone for some fresh air. */
const INDOOR_WORDS = /\b(museum|mall|shopping|underground|station|gallery|greenhouse)\b/i;

let nextNominatimAt = 0;
const searches = createCache<NominatimResult[]>({ ttlMs: SEARCH_CACHE_MS });

async function waitForNominatim() {
  const now = Date.now();
  const startAt = Math.max(now, nextNominatimAt);
  nextNominatimAt = startAt + NOMINATIM_GAP_MS;
  if (startAt > now) await sleep(startAt - now);
}

async function fetchNominatim<T = NominatimResult[]>(url: URL, language = 'en,ko'): Promise<T> {
  await waitForNominatim();
  // Nominatim's usage policy requires an identifying User-Agent.
  const response = await fetch(url, {
    headers: { 'User-Agent': 'touch-grass-agent/0.1', 'Accept-Language': language },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Nominatim failed: ${response.status}`);
  return (await response.json()) as T;
}

const searchNominatim = (url: URL) => searches.getOrLoad(url.toString(), () => fetchNominatim(url));

const cityOf = (address: Record<string, string> = {}) =>
  address.city ?? address.town ?? address.village ?? address.county ?? address.state ?? null;
const areaOf = (address: Record<string, string> = {}) =>
  address.borough ?? address.city_district ?? address.suburb ?? address.quarter ?? null;

/** A Wikidata entry marks a sight people know, rather than a mural or a shop sign tagged as an attraction. */
const isLandmark = (result: NominatimResult) =>
  Boolean(result.extratags?.wikidata) && result.extratags?.indoor !== 'yes' && !INDOOR_WORDS.test(result.name);

/** A city's center by name, in any language; the web app's geocoder (Open-Meteo) doesn't know names like "서울". */
export async function geocodeCity(name: string): Promise<LatLon | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: name, format: 'jsonv2', limit: '1' }).toString();
  const [result] = await searchNominatim(url);
  return result ? { lat: Number(result.lat), lon: Number(result.lon) } : null;
}

/** About 11 m, closer than a phone's location is usually accurate. */
const ADDRESS_DECIMALS = 4;
const addresses = createCache<string | null>({ ttlMs: SEARCH_CACHE_MS });

/**
 * A short street address for where someone is, e.g. "마포구 월드컵북로2길 11", to name the start of the directions.
 * The nearest shop or bus stop that Nominatim also names isn't used, since it reads as if the person were in it.
 */
export function streetAddress({ lat, lon }: LatLon): Promise<string | null> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.search = new URLSearchParams({
    lat: lat.toFixed(ADDRESS_DECIMALS),
    lon: lon.toFixed(ADDRESS_DECIMALS),
    format: 'jsonv2',
    zoom: '18',
    addressdetails: '1',
  }).toString();
  return addresses.getOrLoad(url.toString(), async () => {
    const { address = {} } = await fetchNominatim<Pick<NominatimResult, 'address'>>(url, 'ko,en');
    const district = areaOf(address) ?? cityOf(address);
    const street = address.road ? [address.road, address.house_number].filter(Boolean).join(' ') : address.suburb;
    return [district, street].filter(Boolean).join(' ') || null;
  });
}

/**
 * The outlines of up to 50 places, by outlineKey, in one request. The area search that finds parks returns no
 * polygons, and Overpass takes several seconds longer to send them; places drawn as a line are left out.
 */
export async function getOutlines(outlines: OsmOutline[]): Promise<Map<string, Ring[]>> {
  const url = new URL('https://nominatim.openstreetmap.org/lookup');
  url.search = new URLSearchParams({
    osm_ids: outlines.map(outlineKey).join(','),
    format: 'jsonv2',
    polygon_geojson: '1',
    // About 1 m, which keeps a big park's outline small without moving its edge.
    polygon_threshold: '0.00001',
  }).toString();
  const results = await fetchNominatim<NominatimLookup[]>(url);
  return new Map(
    results.flatMap((result): [string, Ring[]][] => {
      const rings = ringsOf(result.geojson);
      return rings ? [[lookupKey(result.osm_type, result.osm_id), rings]] : [];
    }),
  );
}

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
        outline: outlineOf(result),
      };
    })
    .filter((place) => place.distanceMeters <= radiusM && place.distanceMeters > beyondM);
  const worthTheWalk = reachable.filter((place) => place.distanceMeters >= radiusM * MIN_DISTANCE_RATIO);

  return (worthTheWalk.length > 0 ? worthTheWalk : reachable)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_PLACES)
    .map((place, index) => ({ id: `${idPrefix}${index + 1}`, ...place }));
}
