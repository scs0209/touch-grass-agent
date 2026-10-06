import { lazy, Suspense, useState } from 'react';
import { FIT_LABELS } from '../constants/outfit';
import type { RecommendResponse } from '../types/api';
import type { Fit, Outfit } from '../types/outfit';
import type { StoryInput } from '../types/preview';
import { directionsUrl } from '../utils/directions';
import { describeRoute, storyInput } from '../utils/result';
import { Avatar } from './Avatar';
import { OutfitCards } from './OutfitCards';
import { ResultMap } from './ResultMap';
import { WeatherPanel } from './WeatherPanel';

const WalkPreview = lazy(() => import('./WalkPreview').then((module) => ({ default: module.WalkPreview })));

export function ResultCard({ result, onReset }: { result: RecommendResponse; onReset: () => void }) {
  const { recommendation, conditions, outfits, origin, place, route, bikeStation, source } = result;
  const [fit, setFit] = useState<Fit>('normal');
  const [preview, setPreview] = useState<{ input: StoryInput; outfit: Outfit } | null>(null);
  const outfit = (outfits.find((option) => option.fit === fit) ?? outfits[0]).outfit;
  const isGo = recommendation.verdict === 'go';
  const destination = place ?? bikeStation;
  const routeCaption = describeRoute(result);

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

      {isGo && place && (
        <button
          className="secondary preview-button"
          onClick={() => setPreview({ input: storyInput(result, place, outfit), outfit })}
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

      <button className="link" onClick={onReset}>
        Ask again
      </button>
      <p className="muted small">
        {source === 'model' ? 'Suggested by Gemma running locally' : 'Rule-based suggestion (model unavailable)'}
      </p>
    </main>
  );
}
