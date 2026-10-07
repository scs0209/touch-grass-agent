import { messages } from '../i18n';
import type { Sky } from '../types/weather';

const SKY_ICONS: Record<Sky, string> = {
  clear: 'sun',
  'partly-cloudy': 'sun_behind_cloud',
  cloudy: 'cloud',
  fog: 'fog',
  drizzle: 'sun_behind_rain_cloud',
  rain: 'cloud_with_rain',
  snow: 'cloud_with_snow',
  thunder: 'cloud_with_lightning_and_rain',
};

/** Upper bounds of the WHO UV bands and of the Beaufort-based wind bands, matching the level names in order. */
const UV_BANDS = [3, 6, 8, 11];
const WIND_BANDS_KMH = [6, 20, 39, 62];

/** File name of the Fluent Emoji icon for the sky; clear nights show the moon. */
export function skyIcon(sky: Sky, isDay: boolean) {
  return !isDay && (sky === 'clear' || sky === 'partly-cloudy') ? 'crescent_moon' : SKY_ICONS[sky];
}

const band = (value: number, bounds: number[]) => {
  const index = bounds.findIndex((bound) => value < bound);
  return index === -1 ? bounds.length : index;
};

export const uvLevel = (uvIndex: number) => messages().weather.uvLevels[band(uvIndex, UV_BANDS)];

export const windLevel = (windKmh: number) => messages().weather.windLevels[band(windKmh, WIND_BANDS_KMH)];

export const formatDuration = (minutes: number) => messages().duration(minutes);
