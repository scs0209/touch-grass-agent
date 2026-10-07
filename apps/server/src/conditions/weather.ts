import { createCache } from '../cache.js';
import { gridKey } from '../geo.js';

/** Open-Meteo refreshes current conditions every 15 minutes, on a grid of about 1–2 km. */
export const CONDITIONS_TTL_MS = 10 * 60 * 1000;
/** A brief outage then suggests from the last known weather instead of failing outright. */
export const CONDITIONS_STALE_MS = 30 * 60 * 1000;

const forecasts = createCache<Weather>({ ttlMs: CONDITIONS_TTL_MS, staleMs: CONDITIONS_STALE_MS });

/** Open-Meteo answers in about a second; a request still hanging after 5 rarely finishes, but a new one usually does. */
const ATTEMPT_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 500;

class OpenMeteoError extends Error {
  constructor(
    name: string,
    readonly status: number,
  ) {
    super(`Open-Meteo ${name} failed: ${status}`);
  }
}

async function attempt<T>(url: URL, name: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
  if (!response.ok) throw new OpenMeteoError(name, response.status);
  return (await response.json()) as T;
}

/**
 * Retries once after a timeout, a network error, or a server error, which cover the brief stalls seen from
 * Open-Meteo. Other 4xx answers mean the request itself is wrong, so they fail at once.
 */
export async function fetchOpenMeteo<T>(url: URL, name: string): Promise<T> {
  try {
    return await attempt<T>(url, name);
  } catch (error) {
    if (error instanceof OpenMeteoError && error.status !== 429 && error.status < 500) throw error;
    console.warn(`Retrying Open-Meteo ${name}: ${error instanceof Error ? error.message : error}`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return attempt<T>(url, name);
  }
}

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'freezing fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  56: 'freezing drizzle',
  57: 'heavy freezing drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  66: 'freezing rain',
  67: 'heavy freezing rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  77: 'snow grains',
  80: 'rain showers',
  81: 'heavy rain showers',
  82: 'violent rain showers',
  85: 'snow showers',
  86: 'heavy snow showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'thunderstorm with heavy hail',
};

export type Sky = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

function toSky(code: number): Sky {
  if (code >= 95) return 'thunder';
  if (code >= 85 || (code >= 71 && code <= 77)) return 'snow';
  if (code >= 61) return 'rain';
  if (code >= 51) return 'drizzle';
  if (code >= 45) return 'fog';
  if (code === 3) return 'cloudy';
  if (code === 2) return 'partly-cloudy';
  return 'clear';
}

export interface Weather {
  localTime: string;
  isDay: boolean;
  temperatureC: number;
  feelsLikeC: number;
  description: string;
  sky: Sky;
  precipitationMm: number;
  maxPrecipitationChanceNext3h: number;
  /** Starts with the current hour, as local wall-clock times. */
  precipitationChanceByHour: { time: string; chance: number }[];
  windKmh: number;
  uvIndex: number;
  sunset: string;
  minutesUntilSunset: number;
}

interface OpenMeteoForecast {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    uv_index: number;
    is_day: number;
  };
  hourly: { time: string[]; precipitation_probability: number[] };
  daily: { sunset: string[] };
}

export function getWeather(lat: number, lon: number): Promise<Weather> {
  return forecasts.getOrLoad(gridKey({ lat, lon }, 2), () => fetchWeather(lat, lon));
}

async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,uv_index,is_day',
    hourly: 'precipitation_probability',
    daily: 'sunset',
    forecast_hours: '3',
    forecast_days: '1',
    timezone: 'auto',
  }).toString();

  const data = await fetchOpenMeteo<OpenMeteoForecast>(url, 'forecast');

  const { current } = data;
  const sunset = data.daily.sunset[0];
  // Both timestamps are local wall-clock strings without an offset, so parsing them the same way keeps the diff correct.
  const minutesUntilSunset = Math.round((Date.parse(sunset) - Date.parse(current.time)) / 60000);

  return {
    localTime: current.time,
    isDay: current.is_day === 1,
    temperatureC: current.temperature_2m,
    feelsLikeC: current.apparent_temperature,
    description: WMO_DESCRIPTIONS[current.weather_code] ?? 'unknown',
    sky: toSky(current.weather_code),
    precipitationMm: current.precipitation,
    maxPrecipitationChanceNext3h: Math.max(0, ...data.hourly.precipitation_probability),
    precipitationChanceByHour: data.hourly.time.map((time, index) => ({
      time,
      chance: data.hourly.precipitation_probability[index] ?? 0,
    })),
    windKmh: current.wind_speed_10m,
    uvIndex: current.uv_index,
    sunset,
    minutesUntilSunset,
  };
}
