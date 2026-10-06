import type { LatLon } from '../geo.js';

export interface Route {
  /** [lat, lon] pairs, ready for Leaflet. */
  coordinates: [number, number][];
  /** Where the router snapped the destination onto the path network, as [lat, lon]. */
  destinationOnPath: [number, number];
  distanceM: number;
  durationMin: number;
}

interface OsrmLeg {
  distance: number;
  duration: number;
  steps: { geometry: { coordinates: [number, number][] } }[];
}

interface OsrmResponse {
  code: string;
  waypoints?: { location: [number, number] }[];
  routes?: { legs: OsrmLeg[] }[];
}

const OSRM_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
/** Long enough to cover asking again from the same spot, short enough that routes don't go stale. */
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { route: Promise<Route>; expiresAt: number }>();

const cacheKey = (origin: LatLon, destination: LatLon) =>
  [origin.lat, origin.lon, destination.lat, destination.lon].join(',');

function toRoute(legs: OsrmLeg[], [snappedLon, snappedLat]: [number, number]): Route {
  const coordinates: [number, number][] = [];
  for (const step of legs.flatMap((leg) => leg.steps)) {
    for (const [lon, lat] of step.geometry.coordinates) {
      // Consecutive steps share their boundary point.
      const last = coordinates.at(-1);
      if (!last || last[0] !== lat || last[1] !== lon) coordinates.push([lat, lon]);
    }
  }
  const sum = (key: 'distance' | 'duration') => legs.reduce((total, leg) => total + leg[key], 0);

  return {
    coordinates,
    destinationOnPath: [snappedLat, snappedLon],
    distanceM: Math.round(sum('distance')),
    durationMin: Math.round(sum('duration') / 60),
  };
}

/**
 * Asks OSRM once for origin → A → origin → B → origin …, so every round trip costs a single request
 * to the shared public server. Each pair of legs is exactly the route a separate request would return.
 */
async function fetchRoundTrips(origin: LatLon, destinations: LatLon[]): Promise<Route[]> {
  const waypoints = [origin, ...destinations.flatMap((destination) => [destination, origin])]
    .map(({ lat, lon }) => `${lon},${lat}`)
    .join(';');
  const url = `${OSRM_URL}/${waypoints}?overview=false&steps=true&geometries=geojson`;

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`OSRM failed: ${response.status}`);
  const data = (await response.json()) as OsrmResponse;
  const legs = data.routes?.[0]?.legs;
  const snapped = data.waypoints;
  if (data.code !== 'Ok' || !legs || !snapped) throw new Error(`OSRM returned ${data.code}`);

  return destinations.map((_, index) => toRoute(legs.slice(2 * index, 2 * index + 2), snapped[2 * index + 1].location));
}

function remember(origin: LatLon, destinations: LatLon[]): Promise<Route>[] {
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);

  const routes = fetchRoundTrips(origin, destinations);
  return destinations.map((destination, index) => {
    const key = cacheKey(origin, destination);
    const route = routes.then((all) => all[index]);
    cache.set(key, { route, expiresAt: now + CACHE_TTL_MS });
    // Forget failures so the next request asks OSRM again.
    route.catch(() => {
      if (cache.get(key)?.route === route) cache.delete(key);
    });
    return route;
  });
}

function cached(origin: LatLon, destination: LatLon) {
  const entry = cache.get(cacheKey(origin, destination));
  return entry && entry.expiresAt > Date.now() ? entry.route : undefined;
}

/** Starts fetching round trips to all destinations in the background so the chosen one is ready later. */
export function prefetchRoundTripWalks(origin: LatLon, destinations: LatLon[]) {
  const missing = destinations.filter((destination) => !cached(origin, destination));
  if (missing.length > 0) remember(origin, missing);
}

export function getRoundTripWalk(origin: LatLon, destination: LatLon): Promise<Route> {
  const fetchNow = () => remember(origin, [destination])[0];
  return cached(origin, destination)?.catch(fetchNow) ?? fetchNow();
}
