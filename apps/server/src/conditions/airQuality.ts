import { createCache } from '../cache.js';
import { gridKey } from '../geo.js';
import { CONDITIONS_STALE_MS, CONDITIONS_TTL_MS } from './weather.js';

/** The air quality model's grid is about 11 km, and it updates hourly. */
const readings = createCache<AirQuality>({ ttlMs: CONDITIONS_TTL_MS, staleMs: CONDITIONS_STALE_MS });

export interface AirQuality {
  pm10: number;
  pm25: number;
  europeanAqi: number;
  level: 'good' | 'fair' | 'moderate' | 'poor' | 'very poor' | 'extremely poor';
}

interface OpenMeteoAirQuality {
  current: { pm10: number; pm2_5: number; european_aqi: number };
}

function toLevel(aqi: number): AirQuality['level'] {
  if (aqi <= 20) return 'good';
  if (aqi <= 40) return 'fair';
  if (aqi <= 60) return 'moderate';
  if (aqi <= 80) return 'poor';
  if (aqi <= 100) return 'very poor';
  return 'extremely poor';
}

export function getAirQuality(lat: number, lon: number): Promise<AirQuality> {
  return readings.getOrLoad(gridKey({ lat, lon }, 2), () => fetchAirQuality(lat, lon));
}

async function fetchAirQuality(lat: number, lon: number): Promise<AirQuality> {
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  url.search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'pm10,pm2_5,european_aqi',
    timezone: 'auto',
  }).toString();

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Open-Meteo air quality failed: ${response.status}`);
  const { current } = (await response.json()) as OpenMeteoAirQuality;

  return {
    pm10: current.pm10,
    pm25: current.pm2_5,
    europeanAqi: current.european_aqi,
    level: toLevel(current.european_aqi),
  };
}
