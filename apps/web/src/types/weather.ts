export type Sky = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

export type AirLevel = 'good' | 'fair' | 'moderate' | 'poor' | 'very poor' | 'extremely poor';

export interface WeatherConditions {
  isDay: boolean;
  temperatureC: number;
  feelsLikeC: number;
  description: string;
  sky: Sky;
  rainChance: number;
  /** Starts with the current hour, as local wall-clock times. */
  rainChanceByHour: { time: string; chance: number }[];
  uvIndex: number;
  windKmh: number;
  airQuality: AirLevel;
  airQualityIndex: number;
  sunset: string;
  minutesUntilSunset: number;
}
