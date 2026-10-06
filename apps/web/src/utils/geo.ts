import type { LatLon } from '../types/geo';

const EARTH_RADIUS_M = 6371000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters. */
export function distanceM(a: LatLon, b: LatLon) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Compass bearing from a to b; fine over the few kilometers of a walk. */
export function bearing(a: LatLon, b: LatLon) {
  const dx = (b.lon - a.lon) * Math.cos(toRad((a.lat + b.lat) / 2));
  return (Math.atan2(dx, b.lat - a.lat) * 180) / Math.PI;
}

export function nearestIndex(points: LatLon[], target: LatLon) {
  let nearest = 0;
  points.forEach((point, i) => {
    if (distanceM(point, target) < distanceM(points[nearest], target)) nearest = i;
  });
  return nearest;
}
