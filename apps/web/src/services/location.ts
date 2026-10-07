import { messages } from '../i18n';
import type { LatLon } from '../types/geo';
import { geocodeOnServer } from './api';

/** A position up to maximumAgeMs old is fine for finding nearby places; a check-in needs a fresh, precise one. */
export function getCurrentPosition({ maximumAgeMs = 5 * 60 * 1000, precise = false } = {}) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: 15000,
      maximumAge: maximumAgeMs,
      enableHighAccuracy: precise,
    });
  });
}

export function locationErrorMessage(error: unknown) {
  const t = messages().errors;
  const code = (error as GeolocationPositionError).code;
  return t.location[code] ?? t.locationOther;
}

export function checkInErrorMessage(error: unknown) {
  const t = messages().errors;
  const blocked = (error as GeolocationPositionError).code === 1;
  return blocked ? t.checkInBlocked : t.checkInFailed;
}

type City = LatLon & { name: string };

/** City centers don't move, and Open-Meteo's answer has no cache headers, so each name is looked up once per visit. */
const cities = new Map<string, Promise<City>>();

/** The city's center and its name as Open-Meteo spells it, e.g. "seoul" becomes "Seoul". */
export function geocodeCity(name: string): Promise<City> {
  const key = name.trim().toLowerCase();
  const cached = cities.get(key);
  if (cached) return cached;
  const lookup = lookUpCity(name);
  cities.set(key, lookup);
  // A failed or unknown name is tried again next time.
  lookup.catch(() => cities.delete(key));
  return lookup;
}

async function lookUpCity(name: string): Promise<City> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`;
  const response = await fetch(url);
  const body = (await response.json()) as { results?: { latitude: number; longitude: number; name: string }[] };
  const place = body.results?.[0];
  if (place) return { lat: place.latitude, lon: place.longitude, name: place.name || name };
  // Open-Meteo doesn't know Korean names like "서울"; Nominatim, through the server, does.
  const found = await geocodeOnServer(name);
  if (!found) throw new Error(messages().errors.cityNotFound(name));
  return { ...found, name: name.trim() };
}
