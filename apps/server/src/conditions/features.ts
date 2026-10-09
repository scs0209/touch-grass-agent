import { createCache } from '../cache.js';
import type { LatLon } from '../geo.js';
import { getOutlines, type OsmOutline, outlineKey, type Ring } from './places.js';

export type Feature =
  | 'playground'
  | 'sports field'
  | 'running track'
  | 'outdoor gym'
  | 'benches'
  | 'drinking fountain'
  | 'toilets'
  | 'viewpoint'
  | 'water';

/** OpenStreetMap tag values under leisure, amenity, tourism, or natural, and the feature each one means. */
const OSM_FEATURES: Record<string, Feature> = {
  playground: 'playground',
  pitch: 'sports field',
  track: 'running track',
  fitness_station: 'outdoor gym',
  bench: 'benches',
  drinking_water: 'drinking fountain',
  toilets: 'toilets',
  viewpoint: 'viewpoint',
  water: 'water',
};
const OSM_KEYS = ['leisure', 'amenity', 'tourism', 'natural'];

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/**
 * Nominatim gives one point per park, so look a little around it. Around a small park this also reaches the
 * school field or court next door, so for parks with an outline only what lies inside it counts.
 */
const RADIUS_M = 150;
/** Park facilities rarely change, and the shared Overpass server is slow and rate limited. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Suggestions wait only 3 seconds for features, but the shared server often takes 10 or more; letting a
 * slow answer finish still caches it for the next request instead of asking again every time.
 */
const QUERY_TIMEOUT_S = 25;

export interface ParkLocation extends LatLon {
  outline: OsmOutline | null;
}

interface OverpassElement {
  type: string;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: LatLon;
}

const cache = createCache<Feature[]>({ ttlMs: CACHE_TTL_MS, maxEntries: 2000 });
const cacheKey = ({ lat, lon }: LatLon) => `${lat},${lon}`;

function featureOf(tags: Record<string, string>) {
  for (const key of OSM_KEYS) {
    const feature = OSM_FEATURES[tags[key]];
    if (feature) return feature;
  }
  return undefined;
}

/** Even-odd ray casting, so inner rings count as holes; at park scale, degrees work as flat coordinates. */
function isInside({ lat, lon }: LatLon, rings: Ring[]) {
  let inside = false;
  for (const ring of rings) {
    for (let index = 1; index < ring.length; index++) {
      const [aLon, aLat] = ring[index - 1];
      const [bLon, bLat] = ring[index];
      if (aLat > lat !== bLat > lat && lon < aLon + ((lat - aLat) * (bLon - aLon)) / (bLat - aLat)) inside = !inside;
    }
  }
  return inside;
}

function positionOf(element: OverpassElement): LatLon | null {
  if (element.center) return element.center;
  return element.lat === undefined || element.lon === undefined ? null : { lat: element.lat, lon: element.lon };
}

/** The features among a park's results; with an outline, only those inside it. */
function featuresIn(elements: OverpassElement[], outline: Ring[] | undefined) {
  const features = new Set<Feature>();
  for (const element of elements) {
    const feature = element.tags && featureOf(element.tags);
    const position = positionOf(element);
    if (feature && (!outline || (position && isInside(position, outline)))) features.add(feature);
  }
  return [...features];
}

/** One request for all parks; a `park` marker after each park's results tells them apart. */
async function fetchElements(parks: LatLon[]): Promise<OverpassElement[][]> {
  const filter = `[~"^(${OSM_KEYS.join('|')})$"~"^(${Object.keys(OSM_FEATURES).join('|')})$"]`;
  const queries = parks
    .map(
      ({ lat, lon }, index) =>
        `nwr(around:${RADIUS_M},${lat},${lon})${filter};out center tags;make park index="${index}";out;`,
    )
    .join('');

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: new URLSearchParams({ data: `[out:json][timeout:${QUERY_TIMEOUT_S}];${queries}` }),
    headers: { 'User-Agent': 'touch-grass-agent/0.1' },
    signal: AbortSignal.timeout((QUERY_TIMEOUT_S + 5) * 1000),
  });
  if (!response.ok) throw new Error(`Overpass failed: ${response.status}`);
  const { elements } = (await response.json()) as { elements: OverpassElement[] };

  const lists: OverpassElement[][] = parks.map(() => []);
  let current: OverpassElement[] = [];
  for (const element of elements) {
    if (element.type === 'park') {
      lists[Number(element.tags?.index)] = current;
      current = [];
    } else {
      current.push(element);
    }
  }
  return lists;
}

async function fetchFeatures(parks: ParkLocation[]): Promise<Feature[][]> {
  const refs = parks.flatMap(({ outline }) => (outline ? [outline] : []));
  const [lists, outlines] = await Promise.all([
    fetchElements(parks),
    // Without outlines, everything around a park's point counts, as it does for parks mapped as a point.
    refs.length > 0 ? getOutlines(refs).catch(() => new Map<string, Ring[]>()) : new Map<string, Ring[]>(),
  ]);
  return parks.map(({ outline }, index) =>
    featuresIn(lists[index], outline ? outlines.get(outlineKey(outline)) : undefined),
  );
}

function remember(parks: ParkLocation[]): Promise<Feature[]>[] {
  const all = fetchFeatures(parks);
  return parks.map((park, index) =>
    cache.set(
      cacheKey(park),
      all.then((lists) => lists[index]),
    ),
  );
}

const cached = (park: LatLon) => cache.peek(cacheKey(park));

/** Features found at each park, in the same order; uncached parks share a single request. */
export function getParkFeatures(parks: ParkLocation[]): Promise<Feature[]>[] {
  const missing = parks.filter((park) => !cached(park));
  const fetched = missing.length > 0 ? remember(missing) : [];
  return parks.map((park) => cached(park) ?? fetched[missing.indexOf(park)]);
}
