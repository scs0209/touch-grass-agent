import { createCache } from '../cache.js';
import type { LatLon } from '../geo.js';

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
/** Nominatim gives one point per park, so look a little around it. */
const RADIUS_M = 150;
/** Park facilities rarely change, and the shared Overpass server is slow and rate limited. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Suggestions wait only 3 seconds for features, but the shared server often takes 10 or more; letting a
 * slow answer finish still caches it for the next request instead of asking again every time.
 */
const QUERY_TIMEOUT_S = 25;

interface OverpassElement {
  type: string;
  tags?: Record<string, string>;
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

/** One request for all parks; a `park` marker after each park's results tells them apart. */
async function fetchFeatures(parks: LatLon[]): Promise<Feature[][]> {
  const filter = `[~"^(${OSM_KEYS.join('|')})$"~"^(${Object.keys(OSM_FEATURES).join('|')})$"]`;
  const queries = parks
    .map(
      ({ lat, lon }, index) =>
        `nwr(around:${RADIUS_M},${lat},${lon})${filter};out tags;make park index="${index}";out;`,
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

  const features = parks.map(() => new Set<Feature>());
  let current = new Set<Feature>();
  for (const element of elements) {
    if (element.type === 'park') {
      features[Number(element.tags?.index)] = current;
      current = new Set();
    } else {
      const feature = element.tags && featureOf(element.tags);
      if (feature) current.add(feature);
    }
  }
  return features.map((set) => [...set]);
}

function remember(parks: LatLon[]): Promise<Feature[]>[] {
  const all = fetchFeatures(parks);
  return parks.map((park, index) =>
    cache.set(
      cacheKey(park),
      all.then((lists) => lists[index]),
    ),
  );
}

const cached = (park: LatLon) => cache.peek(cacheKey(park));

/** Features found around each park, in the same order; uncached parks share a single request. */
export function getParkFeatures(parks: LatLon[]): Promise<Feature[]>[] {
  const missing = parks.filter((park) => !cached(park));
  const fetched = missing.length > 0 ? remember(missing) : [];
  return parks.map((park) => cached(park) ?? fetched[missing.indexOf(park)]);
}
