import { type SubmitEvent, useState } from 'react';
import { Questionnaire } from './components/Questionnaire';
import { ResultCard } from './components/ResultCard';
import { useRecommendation } from './hooks/useRecommendation';
import { loadChoice, saveChoice } from './services/choiceStorage';
import type { SavedChoice } from './types/preferences';
import { summarize } from './utils/preferences';

const MINUTE_OPTIONS = [15, 30, 60];
/** Must stay within the server's availableMinutes range in recommendRequestSchema. */
const MIN_MINUTES = 10;
const MAX_MINUTES = 240;
const MINUTE_STEP = 5;

export function App() {
  const [availableMinutes, setAvailableMinutes] = useState(30);
  const [city, setCity] = useState('');
  const [choice, setChoice] = useState<SavedChoice | null>(loadChoice);
  const [editingChoice, setEditingChoice] = useState(false);
  const preferences = choice?.mode === 'custom' ? choice.preferences : null;
  const { status, recommendHere, recommendInCity, reset } = useRecommendation(availableMinutes, preferences);

  function handleCitySubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!city.trim()) return;
    void recommendInCity(city);
  }

  if (!choice || editingChoice) {
    return (
      <Questionnaire
        initial={choice}
        onDone={(picked) => {
          saveChoice(picked);
          setChoice(picked);
          setEditingChoice(false);
        }}
      />
    );
  }

  if (status.kind === 'done') {
    return <ResultCard result={status.result} onReset={reset} />;
  }

  return (
    <main className="screen">
      <h1>Should I go out?</h1>
      <div className="choice-summary">
        <p className="muted small">{summarize(choice)}</p>
        <button className="edit-choice" onClick={() => setEditingChoice(true)}>
          <span aria-hidden="true">✎</span> Edit answers
        </button>
      </div>

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

      <button className="primary" onClick={() => void recommendHere()} disabled={status.kind === 'loading'}>
        Check right here
      </button>

      <form className="city-form" onSubmit={handleCitySubmit}>
        <input
          value={city}
          onChange={(event) => setCity(event.target.value)}
          placeholder="or type a city, e.g. Seoul"
        />
        <button type="submit">Go</button>
      </form>

      {status.kind === 'loading' && (
        <p className="muted shimmer" role="status">
          {status.message}
        </p>
      )}
      {status.kind === 'error' && <p className="error">{status.message}</p>}
    </main>
  );
}
