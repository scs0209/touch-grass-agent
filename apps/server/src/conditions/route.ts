import type { LatLon } from '../geo.js';

export interface Route {
  /** [lat, lon] pairs, ready for Leaflet. */
  coordinates: [number, number][];
  /** Where the router snapped the destination onto the path network, as [lat, lon]. */
  destinationOnPath: [number, number];
  distanceM: number;
  durationMin: number;
}

interface OsrmResponse {
  code: string;
  waypoints?: { location: [number, number] }[];
  routes?: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
  }[];
}

export async function getRoundTripWalk(origin: LatLon, destination: LatLon): Promise<Route> {
  const waypoints = [origin, destination, origin].map(({ lat, lon }) => `${lon},${lat}`).join(';');
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${waypoints}?overview=full&geometries=geojson`;

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`OSRM failed: ${response.status}`);
  const data = (await response.json()) as OsrmResponse;
  const route = data.routes?.[0];
  const snappedDestination = data.waypoints?.[1]?.location;
  if (data.code !== 'Ok' || !route || !snappedDestination) throw new Error(`OSRM returned ${data.code}`);

  return {
    coordinates: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    destinationOnPath: [snappedDestination[1], snappedDestination[0]],
    distanceM: Math.round(route.distance),
    durationMin: Math.round(route.duration / 60),
  };
}
