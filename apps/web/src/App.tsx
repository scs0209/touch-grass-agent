import { type SubmitEvent, useState } from 'react';
import { CheckIn } from './components/CheckIn';
import { ExploreLog } from './components/ExploreLog';
import { Questionnaire } from './components/Questionnaire';
import { RecentPlaces } from './components/RecentPlaces';
import { ResultCard } from './components/ResultCard';
import { Tour } from './components/Tour';
import { useExplorations } from './hooks/useExplorations';
import { useRecentPlaces } from './hooks/useRecentPlaces';
import { useRecommendation } from './hooks/useRecommendation';
import { loadChoice, saveChoice } from './services/choiceStorage';
import { forgetTours } from './services/tourStorage';
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
  const recentPlaces = useRecentPlaces();
  const explorations = useExplorations(recentPlaces.places);
  const { status, recommendHere, recommendInCity, recommendRecent, anotherPlace, reset } = useRecommendation(
    availableMinutes,
    preferences,
    recentPlaces.add,
    explorations.visits,
  );
  const checkInProps = {
    candidates: explorations.candidates,
    status: explorations.checkIn,
    onCheckIn: () => void explorations.checkInHere(),
    onDismiss: explorations.dismiss,
  };
  // Bumping it remounts the home tour, which then finds itself unseen and starts over.
  const [tourRun, setTourRun] = useState(0);

  function replayTour() {
    forgetTours();
    setTourRun((run) => run + 1);
  }

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
    return (
      <ResultCard
        // A new place starts a fresh card, with its own map and outfit choice, from the top of the page.
        key={`${status.result.place?.name}-${status.session.seen.length}`}
        result={status.result}
        around={status.session.origin.label}
        finding={status.finding}
        notice={status.notice}
        visits={explorations.visits}
        checkIn={<CheckIn {...checkInProps} compact />}
        onAnotherPlace={() => void anotherPlace()}
        onReset={reset}
      />
    );
  }

  return (
    <main className="screen">
      <h1>Should I go out?</h1>
      <div className="choice-summary">
        <p className="muted small">{summarize(choice)}</p>
        <button className="edit-choice" onClick={() => setEditingChoice(true)} type="button">
          <span aria-hidden="true">✎</span> Edit answers
        </button>
      </div>

      <CheckIn {...checkInProps} />

      <section className="panel" data-tour="minutes">
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
              type="button"
            >
              {minutes} min
            </button>
          ))}
        </div>
      </section>

      <button
        className="primary"
        data-tour="here"
        onClick={() => void recommendHere()}
        disabled={status.kind === 'loading'}
        type="button"
      >
        Check right here
      </button>

      <form className="city-form" data-tour="city" onSubmit={handleCitySubmit}>
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

      <ExploreLog visits={explorations.visits} />

      <RecentPlaces
        places={recentPlaces.places}
        disabled={status.kind === 'loading'}
        onPick={(place) => void recommendRecent(place)}
        onRemove={recentPlaces.remove}
      />

      <button className="link" onClick={replayTour} type="button">
        How it works
      </button>
      <Tour key={tourRun} id="home" />
    </main>
  );
}
