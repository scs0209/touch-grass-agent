import { useState, type FormEvent } from 'react';
import { Avatar } from './Avatar';
import { OutfitCards, type Outfit } from './OutfitCards';
import { ResultMap } from './ResultMap';
import { WeatherPanel, type WeatherConditions } from './WeatherPanel';

interface NamedPoint {
  name: string;
  lat: number;
  lon: number;
}

type Fit = 'cold' | 'normal' | 'warm';

const FIT_LABELS: Record<Fit, string> = {
  cold: 'Runs cold',
  normal: 'Just right',
  warm: 'Runs warm',
};

interface RecommendResponse {
  recommendation: {
    verdict: 'go' | 'stay';
    activity: string;
    durationMin: number;
    reason: string;
    thingsToDo: string[];
    safetyNote?: string | null;
  };
  outfits: { fit: Fit; outfit: Outfit }[];
  origin: { lat: number; lon: number };
  place: NamedPoint | null;
  route: {
    coordinates: [number, number][];
    destinationOnPath: [number, number];
    distanceM: number;
    durationMin: number;
  } | null;
  bikeStation: (NamedPoint & { bikesAvailable: number }) | null;
  source: 'model' | 'fallback';
  conditions: WeatherConditions;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string }
  | { kind: 'done'; result: RecommendResponse }
  | { kind: 'error'; message: string };

const MINUTE_OPTIONS = [15, 30, 60];
/** Must stay within the server's availableMinutes range in recommendRequestSchema. */
const MIN_MINUTES = 10;
const MAX_MINUTES = 240;
const MINUTE_STEP = 5;

async function fetchRecommendation(lat: number, lon: number, availableMinutes: number) {
  const response = await fetch('/api/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lon, availableMinutes }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong.');
  return body as RecommendResponse;
}

async function geocodeCity(name: string) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`;
  const response = await fetch(url);
  const body = (await response.json()) as { results?: { latitude: number; longitude: number }[] };
  const place = body.results?.[0];
  if (!place) throw new Error(`Couldn't find "${name}".`);
  return { lat: place.latitude, lon: place.longitude };
}

const LOCATION_ERROR_MESSAGES: Record<number, string> = {
  1: 'Location access is blocked. Allow it in your browser settings, or type your city.',
  2: "Your device couldn't work out where you are. Check that Location Services is on for this browser, or type your city.",
  3: 'Finding your location took too long. Check that Location Services is on for this browser, or type your city.',
};

function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000, maximumAge: 5 * 60 * 1000 });
  });
}

export function App() {
  const [availableMinutes, setAvailableMinutes] = useState(30);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [city, setCity] = useState('');

  async function recommendFor(lat: number, lon: number) {
    setStatus({ kind: 'loading', message: 'Checking the sky, the air, and nearby bikes…' });
    try {
      setStatus({ kind: 'done', result: await fetchRecommendation(lat, lon, availableMinutes) });
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  }

  async function handleUseLocation() {
    setStatus({ kind: 'loading', message: 'Finding where you are…' });
    try {
      const { coords } = await getCurrentPosition();
      await recommendFor(coords.latitude, coords.longitude);
    } catch (error) {
      const code = (error as GeolocationPositionError).code;
      setStatus({
        kind: 'error',
        message: LOCATION_ERROR_MESSAGES[code] ?? "Couldn't get your location. Type your city instead.",
      });
    }
  }

  async function handleCitySubmit(event: FormEvent) {
    event.preventDefault();
    if (!city.trim()) return;
    setStatus({ kind: 'loading', message: `Looking up ${city}…` });
    try {
      const { lat, lon } = await geocodeCity(city.trim());
      await recommendFor(lat, lon);
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    }
  }

  if (status.kind === 'done') {
    return <ResultCard result={status.result} onReset={() => setStatus({ kind: 'idle' })} />;
  }

  return (
    <main className="screen">
      <h1>Should I go out?</h1>

      <section className="panel">
        <p className="muted">How much time do you have?</p>

        <p className="minutes-value">{availableMinutes} min</p>
        <input
          type="range"
          className="minutes-slider"
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          step={MINUTE_STEP}
          value={availableMinutes}
          onChange={(event) => setAvailableMinutes(Number(event.target.value))}
          aria-label="Available minutes"
        />

        <div className="chips">
          {MINUTE_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              className={minutes === availableMinutes ? 'chip active' : 'chip'}
              onClick={() => setAvailableMinutes(minutes)}
            >
              {minutes} min
            </button>
          ))}
        </div>
      </section>

      <button className="primary" onClick={handleUseLocation} disabled={status.kind === 'loading'}>
        Check right here
      </button>

      <form className="city-form" onSubmit={handleCitySubmit}>
        <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="or type a city, e.g. Seoul" />
        <button type="submit">Go</button>
      </form>

      {status.kind === 'loading' && <p className="muted">{status.message}</p>}
      {status.kind === 'error' && <p className="error">{status.message}</p>}
    </main>
  );
}

function ResultCard({ result, onReset }: { result: RecommendResponse; onReset: () => void }) {
  const { recommendation, conditions, outfits, origin, place, route, bikeStation, source } = result;
  const [fit, setFit] = useState<Fit>('normal');
  const outfit = (outfits.find((option) => option.fit === fit) ?? outfits[0]).outfit;
  const isGo = recommendation.verdict === 'go';
  const destination = place ?? bikeStation;

  return (
    <main className={`screen result ${recommendation.verdict}`}>
      <section className="panel">
        <p className="verdict">{isGo ? 'Go outside.' : 'Maybe stay in for now.'}</p>
        <h1>{recommendation.activity}</h1>
        <p className="duration">{recommendation.durationMin} minutes</p>
        <p className="reason">{recommendation.reason}</p>
        {recommendation.thingsToDo.length > 0 && (
          <div className="things-to-do">
            <span className="tile-label">Once you're there</span>
            <ul>
              {recommendation.thingsToDo.map((thing) => (
                <li key={thing}>{thing}</li>
              ))}
            </ul>
          </div>
        )}
        {recommendation.safetyNote && <p className="note">{recommendation.safetyNote}</p>}
      </section>

      <WeatherPanel conditions={conditions} />

      {isGo && destination && (
        <section className="panel">
          <ResultMap origin={origin} place={place} route={route} bikeStation={bikeStation} />
          {route && place && (
            <p className="muted small">
              {(route.distanceM / 1000).toFixed(1)} km round trip to {place.name} · about {route.durationMin} min on foot
            </p>
          )}
        </section>
      )}

      {isGo && (
        <section className="panel outfit">
          <h2>What to wear</h2>
          {outfits.length > 1 && (
            <div className="chips">
              {outfits.map((option) => (
                <button
                  key={option.fit}
                  className={option.fit === fit ? 'chip active' : 'chip'}
                  onClick={() => setFit(option.fit)}
                >
                  {FIT_LABELS[option.fit]}
                </button>
              ))}
            </div>
          )}
          <div className="outfit-body">
            <Avatar outfit={outfit} />
            <OutfitCards outfit={outfit} />
          </div>
          <p className="muted small">{outfit.tip}</p>
        </section>
      )}

      {isGo && destination && (
        <a
          className="primary"
          href={`https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lon}&travelmode=walking`}
          target="_blank"
          rel="noreferrer"
        >
          Walk to {destination.name}
        </a>
      )}

      {isGo && <p className="pocket">Now put your phone in your pocket.</p>}

      <button className="link" onClick={onReset}>
        Ask again
      </button>
      <p className="muted small">
        {source === 'model' ? 'Suggested by Gemma running locally' : 'Rule-based suggestion (model unavailable)'}
      </p>
    </main>
  );
}
