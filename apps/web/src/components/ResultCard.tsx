import { lazy, Suspense, useEffect, useState } from 'react';
import { FIT_LABELS } from '../constants/outfit';
import type { RecommendResponse } from '../types/api';
import type { Fit, Outfit } from '../types/outfit';
import type { StoryInput } from '../types/preview';
import { directionsUrl } from '../utils/directions';
import { PLACE_KIND_LABEL, placeArea } from '../utils/places';
import { describeRoute, storyInput } from '../utils/result';
import { Avatar } from './Avatar';
import { OutfitCards } from './OutfitCards';
import { ResultMap } from './ResultMap';
import { WeatherPanel } from './WeatherPanel';

const WalkPreview = lazy(() => import('./WalkPreview').then((module) => ({ default: module.WalkPreview })));

interface ResultCardProps {
  result: RecommendResponse;
  /** Where suggestions start, e.g. "Seoul" or "your location". */
  around: string;
  /** True while another place is being looked up. */
  finding: boolean;
  notice: string | null;
  onAnotherPlace: () => void;
  onReset: () => void;
}

export function ResultCard({ result, around, finding, notice, onAnotherPlace, onReset }: ResultCardProps) {
  const { recommendation, conditions, outfits, origin, place, route, bikeStation, source } = result;
  const [fit, setFit] = useState<Fit>('normal');
  const [preview, setPreview] = useState<{ input: StoryInput; outfit: Outfit } | null>(null);
  const outfit = (outfits.find((option) => option.fit === fit) ?? outfits[0]).outfit;
  const isGo = recommendation.verdict === 'go';
  const destination = place ?? bikeStation;
  const routeCaption = describeRoute(result);

  // The button for another place sits mid-page; the new suggestion should be read from its title.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <main className={`screen result ${recommendation.verdict}`}>
      <section className="panel">
        <p className="verdict">{isGo ? 'Go outside.' : 'Maybe stay in for now.'}</p>
        <h1>{recommendation.activity}</h1>
        {isGo && place && (
          <p className="muted small">{[PLACE_KIND_LABEL[place.kind], placeArea(place)].filter(Boolean).join(' · ')}</p>
        )}
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

      {isGo && place && (
        <div className="another-place">
          <p className="muted small">Not feeling it? Try somewhere else around {around}.</p>
          <button className="secondary" onClick={onAnotherPlace} disabled={finding} type="button">
            {finding ? 'Finding another place…' : '↻ Another place'}
          </button>
          {notice && (
            <p className="note" role="status">
              {notice}
            </p>
          )}
        </div>
      )}

      {isGo && place && (
        <button
          className="secondary preview-button"
          onClick={() => setPreview({ input: storyInput(result, place, outfit), outfit })}
          type="button"
        >
          ▶ Preview your {bikeStation ? 'ride' : 'walk'}
        </button>
      )}
      {preview && (
        <Suspense fallback={null}>
          <WalkPreview input={preview.input} outfit={preview.outfit} onClose={() => setPreview(null)} />
        </Suspense>
      )}

      <WeatherPanel conditions={conditions} />

      {isGo && destination && (
        <section className="panel">
          <ResultMap origin={origin} place={place} route={route} bikeStation={bikeStation} caption={routeCaption} />
          {routeCaption && <p className="muted small">{routeCaption}</p>}
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
                  type="button"
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
          href={place ? directionsUrl(place, bikeStation) : directionsUrl(destination)}
          target="_blank"
          rel="noreferrer"
        >
          {place && bikeStation ? 'Ride' : 'Walk'} to {destination.name}
        </a>
      )}

      {isGo && <p className="pocket">Now put your phone in your pocket.</p>}

      <button className="link" onClick={onReset} type="button">
        Ask again
      </button>
      <p className="muted small">
        {source === 'model' ? 'Suggested by Gemma running locally' : 'Rule-based suggestion (model unavailable)'}
      </p>
    </main>
  );
}
