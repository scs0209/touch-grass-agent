import type { LatLon } from '../types/geo';

const LOCATION_ERROR_MESSAGES: Record<number, string> = {
  1: 'Location access is blocked. Allow it in your browser settings, or type your city.',
  2: "Your device couldn't work out where you are. Check that Location Services is on for this browser, or type your city.",
  3: 'Finding your location took too long. Check that Location Services is on for this browser, or type your city.',
};

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
  const code = (error as GeolocationPositionError).code;
  return LOCATION_ERROR_MESSAGES[code] ?? "Couldn't get your location. Type your city instead.";
}

export function checkInErrorMessage(error: unknown) {
  const blocked = (error as GeolocationPositionError).code === 1;
  return blocked
    ? 'Checking in needs your location. Allow it for this site in your browser settings and try again.'
    : "Couldn't get your location just now. Try again in a moment, ideally out in the open.";
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
  if (!place) throw new Error(`Couldn't find "${name}".`);
  return { lat: place.latitude, lon: place.longitude, name: place.name || name };
}
