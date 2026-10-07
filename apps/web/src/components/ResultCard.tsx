import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { useStreetAddress } from '../hooks/useStreetAddress';
import { useMessages } from '../i18n';
import type { RecommendResponse } from '../types/api';
import type { Visit } from '../types/explore';
import type { Fit, Outfit } from '../types/outfit';
import type { StoryInput } from '../types/preview';
import { directionsUrl, inKorea } from '../utils/directions';
import { discoveryLabel, placeNote } from '../utils/explore';
import { placeArea } from '../utils/places';
import { describeRoute, storyInput } from '../utils/result';
import { Avatar } from './Avatar';
import { OutfitCards } from './OutfitCards';
import { ResultMap } from './ResultMap';
import { Tour } from './Tour';
import { WeatherPanel } from './WeatherPanel';

const WalkPreview = lazy(() => import('./WalkPreview').then((module) => ({ default: module.WalkPreview })));

interface ResultCardProps {
  result: RecommendResponse;
  /** Where suggestions start, e.g. "Seoul" or "your location". */
  around: string;
  /** The city searched from, for the directions; null when starting from the person's location. */
  startCity: string | null;
  /** True while another place is being looked up. */
  finding: boolean;
  notice: string | null;
  /** Places the person checked in at, to say what this one would be for them. */
  visits: Visit[];
  /** Shown under the directions, for checking in once there. */
  checkIn: ReactNode;
  onAnotherPlace: () => void;
  onReset: () => void;
}

export function ResultCard({
  result,
  around,
  startCity,
  finding,
  notice,
  visits,
  checkIn,
  onAnotherPlace,
  onReset,
}: ResultCardProps) {
  const { result: t, places } = useMessages();
  const { recommendation, conditions, outfits, origin, place, route, bikeStation, source } = result;
  const [fit, setFit] = useState<Fit>('normal');
  const [preview, setPreview] = useState<{ input: StoryInput; outfit: Outfit } | null>(null);
  const outfit = (outfits.find((option) => option.fit === fit) ?? outfits[0]).outfit;
  const isGo = recommendation.verdict === 'go';
  const destination = place ?? bikeStation;
  // Only Kakao Map names the start; Google Maps starts from where the phone is.
  const namesStart = isGo && destination !== null && startCity === null && inKorea(destination);
  const startAddress = useStreetAddress(namesStart ? origin : null);
  const directions =
    destination &&
    directionsUrl({ origin, startCity, startAddress, destination, bikeStation: place ? bikeStation : null });
  const routeCaption = describeRoute(result);
  const note = place && placeNote(visits, place);

  // The button for another place sits mid-page; the new suggestion should be read from its title.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <main className={`screen result ${recommendation.verdict}`}>
      <section className="panel">
        <p className="verdict">{isGo ? t.go : t.stay}</p>
        <h1>{recommendation.activity}</h1>
        {isGo && place && (
          <p className="muted small">{[places.kind[place.kind], placeArea(place)].filter(Boolean).join(' · ')}</p>
        )}
        {isGo && note && <p className="discovery small">{note}</p>}
        <p className="duration">{t.minutes(recommendation.durationMin)}</p>
        <p className="reason">{recommendation.reason}</p>
        {recommendation.thingsToDo.length > 0 && (
          <div className="things-to-do">
            <span className="tile-label">{t.onceThere}</span>
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
          <p className="muted small">{t.notFeelingIt(around)}</p>
          <button className="secondary" onClick={onAnotherPlace} disabled={finding} type="button">
            {finding ? t.finding : t.another}
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
          data-tour="preview"
          onClick={() =>
            setPreview({ input: storyInput(result, place, outfit, discoveryLabel(visits, place)), outfit })
          }
          type="button"
        >
          {t.preview(Boolean(bikeStation))}
        </button>
      )}
      {preview && (
        <Suspense fallback={null}>
          <WalkPreview
            input={preview.input}
            outfit={preview.outfit}
            directions={directions}
            onClose={() => setPreview(null)}
          />
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
          <h2>{t.wear}</h2>
          {outfits.length > 1 && (
            <div className="chips">
              {outfits.map((option) => (
                <button
                  key={option.fit}
                  className={option.fit === fit ? 'chip active' : 'chip'}
                  onClick={() => setFit(option.fit)}
                  type="button"
                >
                  {t.fit[option.fit]}
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

      {isGo && destination && directions && (
        <a className="primary" data-tour="directions" href={directions} target="_blank" rel="noreferrer">
          {t.directions(Boolean(place && bikeStation), destination.name)}
        </a>
      )}

      {isGo && place && checkIn}

      {isGo && <p className="pocket">{t.pocket}</p>}

      <button className="link" onClick={onReset} type="button">
        {t.askAgain}
      </button>
      <p className="muted small">{source === 'model' ? t.byModel : t.byRules}</p>
      {isGo && place && <Tour id="result" />}
    </main>
  );
}
