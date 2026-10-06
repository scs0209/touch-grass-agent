export type Sky = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

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
  airQuality: string;
  airQualityIndex: number;
  sunset: string;
  minutesUntilSunset: number;
}

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

/** European AQI tops out its "extremely poor" band above 100. */
const MAX_AQI = 120;
/** UV 11 and above is "extreme" on the WHO scale. */
const MAX_UV = 11;
/** Above about 62 km/h is a gale on the Beaufort scale. */
const MAX_WIND_KMH = 62;

function uvLevel(uvIndex: number) {
  if (uvIndex < 3) return 'Low';
  if (uvIndex < 6) return 'Moderate';
  if (uvIndex < 8) return 'High';
  if (uvIndex < 11) return 'Very high';
  return 'Extreme';
}

function windLevel(windKmh: number) {
  if (windKmh < 6) return 'Calm';
  if (windKmh < 20) return 'Light breeze';
  if (windKmh < 39) return 'Breezy';
  if (windKmh < 62) return 'Strong wind';
  return 'Gale';
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
}

function Scale({ kind, value, max }: { kind: 'air' | 'uv' | 'wind'; value: number; max: number }) {
  const position = Math.min(Math.max(value / max, 0), 1) * 100;
  return (
    <div className={`scale ${kind}`} aria-hidden="true">
      <span className="scale-marker" style={{ left: `${position}%` }} />
    </div>
  );
}

export function WeatherPanel({ conditions }: { conditions: WeatherConditions }) {
  const { sky, isDay, rainChanceByHour, minutesUntilSunset } = conditions;
  const icon = !isDay && (sky === 'clear' || sky === 'partly-cloudy') ? 'crescent_moon' : SKY_ICONS[sky];
  const sunsetTime = conditions.sunset.slice(11, 16);

  return (
    <section className="panel weather">
      <div className="weather-now">
        <img src={`/fluent-emoji/${icon}_3d.png`} alt="" width={72} height={72} />
        <p className="temperature">{Math.round(conditions.temperatureC)}°</p>
        <div>
          <p className="weather-description">{conditions.description}</p>
          <p className="muted small">Feels like {Math.round(conditions.feelsLikeC)}°</p>
        </div>
      </div>

      <ul className="weather-tiles">
        <li className="weather-tile">
          <span className="tile-label">Rain</span>
          <span className="tile-value">{conditions.rainChance}%</span>
          <div className="rain-bars" aria-hidden="true">
            {rainChanceByHour.map(({ time, chance }, index) => (
              <div key={time} className="rain-bar">
                <div className="rain-bar-track">
                  <div className="rain-bar-fill" style={{ height: `${chance}%` }} />
                </div>
                <span>{index === 0 ? 'Now' : time.slice(11, 16)}</span>
              </div>
            ))}
          </div>
        </li>
        <li className="weather-tile">
          <span className="tile-label">Air</span>
          <span className="tile-value capitalize">{conditions.airQuality}</span>
          <Scale kind="air" value={conditions.airQualityIndex} max={MAX_AQI} />
          <span className="muted small">Index {conditions.airQualityIndex}</span>
        </li>
        <li className="weather-tile">
          <span className="tile-label">UV</span>
          <span className="tile-value">{Math.round(conditions.uvIndex)}</span>
          <Scale kind="uv" value={conditions.uvIndex} max={MAX_UV} />
          <span className="muted small">{uvLevel(conditions.uvIndex)}</span>
        </li>
        <li className="weather-tile">
          <span className="tile-label">Wind</span>
          <span className="tile-value">{Math.round(conditions.windKmh)} km/h</span>
          <Scale kind="wind" value={conditions.windKmh} max={MAX_WIND_KMH} />
          <span className="muted small">{windLevel(conditions.windKmh)}</span>
        </li>
      </ul>

      <p className="sun-line">
        <img src="/fluent-emoji/sunset_3d.png" alt="" width={24} height={24} />
        {minutesUntilSunset >= 0
          ? `Sunset ${sunsetTime} · in ${formatDuration(minutesUntilSunset)}`
          : `The sun set at ${sunsetTime}`}
      </p>
    </section>
  );
}
