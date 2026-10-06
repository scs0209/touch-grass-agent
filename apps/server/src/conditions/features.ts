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

interface OverpassElement {
  type: string;
  tags?: Record<string, string>;
}

const cache = new Map<string, { features: Promise<Feature[]>; expiresAt: number }>();
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
    body: new URLSearchParams({ data: `[out:json][timeout:8];${queries}` }),
    headers: { 'User-Agent': 'touch-grass-agent/0.1' },
    signal: AbortSignal.timeout(10000),
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
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);

  const all = fetchFeatures(parks);
  return parks.map((park, index) => {
    const key = cacheKey(park);
    const features = all.then((lists) => lists[index]);
    cache.set(key, { features, expiresAt: now + CACHE_TTL_MS });
    // Forget failures so the next request asks Overpass again.
    features.catch(() => {
      if (cache.get(key)?.features === features) cache.delete(key);
    });
    return features;
  });
}

function cached(park: LatLon) {
  const entry = cache.get(cacheKey(park));
  return entry && entry.expiresAt > Date.now() ? entry.features : undefined;
}

/** Features found around each park, in the same order; uncached parks share a single request. */
export function getParkFeatures(parks: LatLon[]): Promise<Feature[]>[] {
  const missing = parks.filter((park) => !cached(park));
  const fetched = missing.length > 0 ? remember(missing) : [];
  return parks.map((park) => cached(park) ?? fetched[missing.indexOf(park)]);
}
