import { useEffect, useRef } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import type { CheckInStatus } from '../hooks/useExplorations';
import { useMessages } from '../i18n';
import type { RecentPlace } from '../types/places';
import { type ArrivalSummary, arrivalLine, candidateNames } from '../utils/explore';
import { formatDistance } from '../utils/places';

interface CheckInProps {
  candidates: RecentPlace[];
  status: CheckInStatus;
  onCheckIn: () => void;
  onDismiss: () => void;
  /** On the result screen, a line and a button under the directions instead of a card of its own. */
  compact?: boolean;
}

/** Saves a suggested place as explored once the person is actually there. */
export function CheckIn({ candidates, status, onCheckIn, onDismiss, compact = false }: CheckInProps) {
  const t = useMessages().checkIn;
  const arrival =
    status.kind === 'arrived' ? (
      <ArrivalDialog place={status.place} summary={status.summary} onClose={onDismiss} />
    ) : null;
  if (candidates.length === 0) return arrival;

  const names = candidateNames(candidates);
  const controls = (
    <>
      <button className="secondary" onClick={onCheckIn} disabled={status.kind === 'locating'} type="button">
        {status.kind === 'locating' ? t.locating : t.button}
      </button>
      {status.kind === 'far' && (
        <p className="note" role="status">
          {t.far(formatDistance(status.distanceM), status.place.name)}
        </p>
      )}
      {status.kind === 'error' && <p className="error">{status.message}</p>}
      {arrival}
    </>
  );

  if (compact) {
    return (
      <div className="check-in" data-tour="check-in">
        <p className="muted small">{t.compactBody(names)}</p>
        {controls}
      </div>
    );
  }

  return (
    <section className="panel check-in" aria-labelledby="check-in-title">
      <h2 id="check-in-title">{t.title}</h2>
      <p className="muted small">{t.body(names)}</p>
      {controls}
    </section>
  );
}

interface ArrivalDialogProps {
  place: RecentPlace;
  summary: ArrivalSummary;
  onClose: () => void;
}

function ArrivalDialog({ place, summary, onClose }: ArrivalDialogProps) {
  const t = useMessages().checkIn;
  const closeRef = useRef<HTMLButtonElement>(null);
  const { finished, advanced, newBadges } = summary;
  const things = place.thingsToDo ?? [];
  useEscapeKey(onClose);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="dialog-backdrop">
      <div className="panel arrival" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
        <p className="verdict">{t.madeIt}</p>
        <h2 id="arrival-title">{place.name}</h2>
        <p className="muted small">{arrivalLine(summary)}</p>
        {(finished.length > 0 || advanced || newBadges.length > 0) && (
          <ul className="arrival-progress">
            {finished.map((mission) => (
              <li key={mission.id}>✓ {mission.title}</li>
            ))}
            {advanced && (
              <li>
                {advanced.title} · {advanced.progress}/{advanced.goal}
              </li>
            )}
            {newBadges.map((badge) => (
              <li key={badge.id}>
                {t.newBadge} <strong>{badge.title}</strong>
              </li>
            ))}
          </ul>
        )}
        {things.length > 0 && (
          <div className="things-to-do">
            <span className="tile-label">{t.nowThatYoureHere}</span>
            <ul>
              {things.map((thing) => (
                <li key={thing}>{thing}</li>
              ))}
            </ul>
          </div>
        )}
        <button ref={closeRef} className="primary" onClick={onClose} type="button">
          {t.putPhoneAway}
        </button>
      </div>
    </div>
  );
}
