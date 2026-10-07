import { createCache } from '../cache.js';
import type { LatLon } from '../geo.js';

export type TravelMode = 'foot' | 'bike';

export interface Route {
  mode: TravelMode;
  /** [lat, lon] pairs, ready for Leaflet. */
  coordinates: [number, number][];
  /** Where the router snapped the destination onto the path network, as [lat, lon]. */
  destinationOnPath: [number, number];
  distanceM: number;
  /** The whole trip, including renting and returning the bike on a bike trip. */
  durationMin: number;
  /** Minutes on the bike; 0 on foot. */
  rideMin: number;
  /** Minutes on foot; on a bike trip, the walk to the station and back home from it. */
  walkMin: number;
  /** First and last index in coordinates of the part on the bike; null on foot. */
  rideRange: [number, number] | null;
}

/** A round trip on one travel mode, as the router returns it. */
interface RoundTrip {
  coordinates: [number, number][];
  destinationOnPath: [number, number];
  distanceM: number;
  durationMin: number;
  /** Index in coordinates of the turnaround point, where the way back begins. */
  returnStart: number;
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

const osrmUrl = (mode: TravelMode) => `https://routing.openstreetmap.de/routed-${mode}/route/v1/${mode}`;
/**
 * Picking a recent place again later that day asks for the same round trip; streets change far more
 * slowly than that, and OSRM's map data updates about once a day.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Unlocking a Ddareungi bike at the station and docking it again. */
const RENT_AND_RETURN_MIN = 2;

const cache = createCache<RoundTrip>({ ttlMs: CACHE_TTL_MS, maxEntries: 2000 });

const cacheKey = (mode: TravelMode, origin: LatLon, destination: LatLon) =>
  [mode, origin.lat, origin.lon, destination.lat, destination.lon].join(',');

function toRoundTrip([out, back]: OsrmLeg[], [snappedLon, snappedLat]: [number, number]): RoundTrip {
  const coordinates: [number, number][] = [];
  let returnStart = 0;
  for (const leg of [out, back]) {
    if (leg === back) returnStart = coordinates.length - 1;
    for (const [lon, lat] of leg.steps.flatMap((step) => step.geometry.coordinates)) {
      // Consecutive steps share their boundary point.
      const last = coordinates.at(-1);
      if (!last || last[0] !== lat || last[1] !== lon) coordinates.push([lat, lon]);
    }
  }

  return {
    coordinates,
    destinationOnPath: [snappedLat, snappedLon],
    distanceM: Math.round(out.distance + back.distance),
    durationMin: Math.round((out.duration + back.duration) / 60),
    returnStart,
  };
}

/**
 * Asks OSRM once for origin → A → origin → B → origin …, so every round trip costs a single request
 * to the shared public server. Each pair of legs is exactly the route a separate request would return.
 */
async function fetchRoundTrips(mode: TravelMode, origin: LatLon, destinations: LatLon[]): Promise<RoundTrip[]> {
  const waypoints = [origin, ...destinations.flatMap((destination) => [destination, origin])]
    .map(({ lat, lon }) => `${lon},${lat}`)
    .join(';');
  const url = `${osrmUrl(mode)}/${waypoints}?overview=false&steps=true&geometries=geojson`;

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`OSRM failed: ${response.status}`);
  const data = (await response.json()) as OsrmResponse;
  const legs = data.routes?.[0]?.legs;
  const snapped = data.waypoints;
  if (data.code !== 'Ok' || !legs || !snapped) throw new Error(`OSRM returned ${data.code}`);

  return destinations.map((_, index) =>
    toRoundTrip(legs.slice(2 * index, 2 * index + 2), snapped[2 * index + 1].location),
  );
}

function remember(mode: TravelMode, origin: LatLon, destinations: LatLon[]): Promise<RoundTrip>[] {
  const trips = fetchRoundTrips(mode, origin, destinations);
  return destinations.map((destination, index) =>
    cache.set(
      cacheKey(mode, origin, destination),
      trips.then((all) => all[index]),
    ),
  );
}

const cached = (mode: TravelMode, origin: LatLon, destination: LatLon) =>
  cache.peek(cacheKey(mode, origin, destination));

function getRoundTrip(mode: TravelMode, origin: LatLon, destination: LatLon): Promise<RoundTrip> {
  const fetchNow = () => remember(mode, origin, [destination])[0];
  return cached(mode, origin, destination)?.catch(fetchNow) ?? fetchNow();
}

const asWalk = ({ returnStart, ...trip }: RoundTrip): Route => ({
  ...trip,
  mode: 'foot',
  rideMin: 0,
  walkMin: trip.durationMin,
  rideRange: null,
});

/** Round trips on foot to every destination, fetched in one request except for those still cached. */
export function getRoundTripWalks(origin: LatLon, destinations: LatLon[]): Promise<Route>[] {
  const missing = destinations.filter((destination) => !cached('foot', origin, destination));
  const fetched = missing.length > 0 ? remember('foot', origin, missing) : [];
  return destinations.map((destination) =>
    (cached('foot', origin, destination) ?? fetched[missing.indexOf(destination)]).then(asWalk),
  );
}

export async function getRoundTripWalk(origin: LatLon, destination: LatLon): Promise<Route> {
  return asWalk(await getRoundTrip('foot', origin, destination));
}

/** Walk to the station, ride to the destination and back, dock the bike, and walk home. */
export async function getRoundTripRide(origin: LatLon, station: LatLon, destination: LatLon): Promise<Route> {
  const [walk, ride] = await Promise.all([
    getRoundTrip('foot', origin, station),
    getRoundTrip('bike', station, destination),
  ]);
  return asRide(walk, ride);
}

/** Bike round trips from one station to every destination, fetched in one request except for those still cached. */
export function getRoundTripRides(origin: LatLon, station: LatLon, destinations: LatLon[]): Promise<Route>[] {
  const walk = getRoundTrip('foot', origin, station);
  const missing = destinations.filter((destination) => !cached('bike', station, destination));
  const fetched = missing.length > 0 ? remember('bike', station, missing) : [];
  return destinations.map(async (destination) => {
    const ride = cached('bike', station, destination) ?? fetched[missing.indexOf(destination)];
    return asRide(await walk, await ride);
  });
}

function asRide(walk: RoundTrip, ride: RoundTrip): Route {
  return {
    mode: 'bike',
    coordinates: [
      ...walk.coordinates.slice(0, walk.returnStart),
      ...ride.coordinates,
      ...walk.coordinates.slice(walk.returnStart + 1),
    ],
    destinationOnPath: ride.destinationOnPath,
    distanceM: walk.distanceM + ride.distanceM,
    durationMin: walk.durationMin + ride.durationMin + RENT_AND_RETURN_MIN,
    rideMin: ride.durationMin,
    walkMin: walk.durationMin,
    rideRange: [walk.returnStart, walk.returnStart + ride.coordinates.length - 1],
  };
}
