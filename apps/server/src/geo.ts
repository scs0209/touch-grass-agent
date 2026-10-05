export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6371000;
const METERS_PER_DEGREE_LAT = 111320;

export function distanceInMeters(a: LatLon, b: LatLon) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Bounding box as Nominatim's `viewbox` order: left,top,right,bottom. */
export function viewboxAround({ lat, lon }: LatLon, radiusM: number) {
  const dLat = radiusM / METERS_PER_DEGREE_LAT;
  const dLon = radiusM / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat + dLat, lon + dLon, lat - dLat].join(',');
}
