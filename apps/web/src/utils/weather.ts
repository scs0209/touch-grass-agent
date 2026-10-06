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

/** File name of the Fluent Emoji icon for the sky; clear nights show the moon. */
export function skyIcon(sky: Sky, isDay: boolean) {
  return !isDay && (sky === 'clear' || sky === 'partly-cloudy') ? 'crescent_moon' : SKY_ICONS[sky];
}

export function uvLevel(uvIndex: number) {
  if (uvIndex < 3) return 'Low';
  if (uvIndex < 6) return 'Moderate';
  if (uvIndex < 8) return 'High';
  if (uvIndex < 11) return 'Very high';
  return 'Extreme';
}

export function windLevel(windKmh: number) {
  if (windKmh < 6) return 'Calm';
  if (windKmh < 20) return 'Light breeze';
  if (windKmh < 39) return 'Breezy';
  if (windKmh < 62) return 'Strong wind';
  return 'Gale';
}

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
}
