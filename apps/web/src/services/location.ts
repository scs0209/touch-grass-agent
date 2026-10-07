import type { LatLon } from '../types/geo';

const LOCATION_ERROR_MESSAGES: Record<number, string> = {
  1: 'Location access is blocked. Allow it in your browser settings, or type your city.',
  2: "Your device couldn't work out where you are. Check that Location Services is on for this browser, or type your city.",
  3: 'Finding your location took too long. Check that Location Services is on for this browser, or type your city.',
};

export function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000, maximumAge: 5 * 60 * 1000 });
  });
}

export function locationErrorMessage(error: unknown) {
  const code = (error as GeolocationPositionError).code;
  return LOCATION_ERROR_MESSAGES[code] ?? "Couldn't get your location. Type your city instead.";
}

/** The city's center and its name as Open-Meteo spells it, e.g. "seoul" becomes "Seoul". */
export async function geocodeCity(name: string): Promise<LatLon & { name: string }> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`;
  const response = await fetch(url);
  const body = (await response.json()) as { results?: { latitude: number; longitude: number; name: string }[] };
  const place = body.results?.[0];
  if (!place) throw new Error(`Couldn't find "${name}".`);
  return { lat: place.latitude, lon: place.longitude, name: place.name || name };
}
