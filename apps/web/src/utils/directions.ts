import { messages } from '../i18n';
import type { LatLon, NamedPoint } from '../types/geo';
import { placeArea } from './places';

type Stop = NamedPoint & { area?: string | null; city?: string | null };

interface Trip {
  /** The person's location, or the center of the city searched from. */
  origin: LatLon;
  /** The city searched from; null when starting from the person's location. */
  startCity: string | null;
  /** The street address of the person's location, for naming the start on Kakao Map. */
  startAddress: string | null;
  destination: Stop;
  /** Set on a bike trip, which goes through the station where the bike is rented. */
  bikeStation: NamedPoint | null;
}

/** Mainland, Jeju, and Ulleungdo with Dokdo; Japan's Tsushima sits inside the mainland box. */
const KOREA = [
  { south: 34, north: 38.62, west: 124.6, east: 129.6 },
  { south: 33.1, north: 33.6, west: 126.1, east: 127 },
  { south: 37.2, north: 37.6, west: 130.7, east: 131.9 },
];
const TSUSHIMA = { south: 34, north: 34.75, west: 129.15, east: 129.6 };

type Bounds = (typeof KOREA)[number];
const within = ({ lat, lon }: LatLon, box: Bounds) =>
  lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
export const inKorea = (point: LatLon) => KOREA.some((box) => within(point, box)) && !within(point, TSUSHIMA);

/** Ddareungi station names start with the station number, e.g. "102. 망원역 1번출구 앞". */
const withoutNumber = (name: string) => name.replace(/^\d+\.\s*/, '');

/** Commas and slashes separate the parts of a Kakao Map link, so they can't appear in a name. */
const kakaoStop = (name: string, { lat, lon }: LatLon) =>
  [withoutNumber(name).replace(/[,/]/g, ' '), lat, lon].map((part) => encodeURIComponent(part)).join(',');

/** Google Maps has no walking or cycling directions in Korea; Kakao Map takes each stop's name and exact spot. */
function kakaoUrl({ origin, startCity, startAddress, destination, bikeStation }: Trip) {
  const start = kakaoStop(startCity ?? startAddress ?? messages().hereLabel, origin);
  const station = bikeStation ? [kakaoStop(bikeStation.name, bikeStation)] : [];
  const stops = [start, ...station, kakaoStop(destination.name, destination)];
  return `https://map.kakao.com/link/by/${bikeStation ? 'bicycle' : 'walk'}/${stops.join('/')}`;
}

const describeStop = (stop: Stop) =>
  [withoutNumber(stop.name), placeArea({ area: stop.area ?? null, city: stop.city ?? null })]
    .filter(Boolean)
    .join(', ');

/**
 * Google Maps by name, since bare coordinates show up there as plus codes like "8Q98FXH5+WRF". Without a start
 * city it starts from where the phone is.
 */
function googleUrl({ startCity, destination, bikeStation }: Trip) {
  const params = new URLSearchParams({
    api: '1',
    destination: describeStop(destination),
    travelmode: bikeStation ? 'bicycling' : 'walking',
  });
  if (startCity) params.set('origin', startCity);
  if (bikeStation) params.set('waypoints', describeStop({ ...bikeStation, city: destination.city }));
  return `https://www.google.com/maps/dir/?${params}`;
}

export const directionsUrl = (trip: Trip) => (inKorea(trip.destination) ? kakaoUrl(trip) : googleUrl(trip));
