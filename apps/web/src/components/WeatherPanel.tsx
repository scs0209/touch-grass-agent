import { useMessages } from '../i18n';
import type { WeatherConditions } from '../types/weather';
import { formatDuration, skyIcon, uvLevel, windLevel } from '../utils/weather';

/** European AQI tops out its "extremely poor" band above 100. */
const MAX_AQI = 120;
/** UV 11 and above is "extreme" on the WHO scale. */
const MAX_UV = 11;
/** Above about 62 km/h is a gale on the Beaufort scale. */
const MAX_WIND_KMH = 62;

function Scale({ kind, value, max }: { kind: 'air' | 'uv' | 'wind'; value: number; max: number }) {
  const position = Math.min(Math.max(value / max, 0), 1) * 100;
  return (
    <div className={`scale ${kind}`} aria-hidden="true">
      <span className="scale-marker" style={{ left: `${position}%` }} />
    </div>
  );
}

export function WeatherPanel({ conditions }: { conditions: WeatherConditions }) {
  const t = useMessages().weather;
  const { sky, isDay, rainChanceByHour, minutesUntilSunset } = conditions;
  const icon = skyIcon(sky, isDay);
  const sunsetTime = conditions.sunset.slice(11, 16);

  return (
    <section className="panel weather">
      <div className="weather-now">
        <img src={`/fluent-emoji/${icon}_3d.png`} alt="" width={72} height={72} />
        <p className="temperature">{Math.round(conditions.temperatureC)}°</p>
        <div>
          <p className="weather-description">{t.describe(conditions.description)}</p>
          <p className="muted small">{t.feelsLike(Math.round(conditions.feelsLikeC))}</p>
        </div>
      </div>

      <ul className="weather-tiles">
        <li className="weather-tile">
          <span className="tile-label">{t.rain}</span>
          <span className="tile-value">{conditions.rainChance}%</span>
          <div className="rain-bars" aria-hidden="true">
            {rainChanceByHour.map(({ time, chance }, index) => (
              <div key={time} className="rain-bar">
                <div className="rain-bar-track">
                  <div className="rain-bar-fill" style={{ height: `${chance}%` }} />
                </div>
                <span>{index === 0 ? t.now : time.slice(11, 16)}</span>
              </div>
            ))}
          </div>
        </li>
        <li className="weather-tile">
          <span className="tile-label">{t.air}</span>
          <span className="tile-value capitalize">{t.airLevels[conditions.airQuality]}</span>
          <Scale kind="air" value={conditions.airQualityIndex} max={MAX_AQI} />
          <span className="muted small">{t.index(conditions.airQualityIndex)}</span>
        </li>
        <li className="weather-tile">
          <span className="tile-label">{t.uv}</span>
          <span className="tile-value">{Math.round(conditions.uvIndex)}</span>
          <Scale kind="uv" value={conditions.uvIndex} max={MAX_UV} />
          <span className="muted small">{uvLevel(conditions.uvIndex)}</span>
        </li>
        <li className="weather-tile">
          <span className="tile-label">{t.wind}</span>
          <span className="tile-value">{Math.round(conditions.windKmh)} km/h</span>
          <Scale kind="wind" value={conditions.windKmh} max={MAX_WIND_KMH} />
          <span className="muted small">{windLevel(conditions.windKmh)}</span>
        </li>
      </ul>

      <p className="sun-line">
        <img src="/fluent-emoji/sunset_3d.png" alt="" width={24} height={24} />
        {minutesUntilSunset >= 0 ? t.sunsetIn(sunsetTime, formatDuration(minutesUntilSunset)) : t.sunSet(sunsetTime)}
      </p>
    </section>
  );
}
