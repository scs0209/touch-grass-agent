import { useEffect, useRef } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import type { CheckInStatus } from '../hooks/useExplorations';
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
  const arrival =
    status.kind === 'arrived' ? (
      <ArrivalDialog place={status.place} summary={status.summary} onClose={onDismiss} />
    ) : null;
  if (candidates.length === 0) return arrival;

  const names = candidateNames(candidates);
  const controls = (
    <>
      <button className="secondary" onClick={onCheckIn} disabled={status.kind === 'locating'} type="button">
        {status.kind === 'locating' ? 'Checking where you are…' : "📍 I'm here"}
      </button>
      {status.kind === 'far' && (
        <p className="note" role="status">
          You're about {formatDistance(status.distanceM)} from {status.place.name}. Check in once you're there.
        </p>
      )}
      {status.kind === 'error' && <p className="error">{status.message}</p>}
      {arrival}
    </>
  );

  if (compact) {
    return (
      <div className="check-in">
        <p className="muted small">At {names}? Check in to add it to your explorations.</p>
        {controls}
      </div>
    );
  }

  return (
    <section className="panel check-in" aria-labelledby="check-in-title">
      <h2 id="check-in-title">Out exploring?</h2>
      <p className="muted small">
        Made it to {names}? Check in to add it to your explorations. Your location is only compared on this device.
      </p>
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
  const closeRef = useRef<HTMLButtonElement>(null);
  const { finished, advanced, newBadges } = summary;
  const things = place.thingsToDo ?? [];
  useEscapeKey(onClose);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="arrival-backdrop">
      <div className="panel arrival" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
        <p className="verdict">You made it.</p>
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
                New badge: <strong>{badge.title}</strong>
              </li>
            ))}
          </ul>
        )}
        {things.length > 0 && (
          <div className="things-to-do">
            <span className="tile-label">Now that you're here</span>
            <ul>
              {things.map((thing) => (
                <li key={thing}>{thing}</li>
              ))}
            </ul>
          </div>
        )}
        <button ref={closeRef} className="primary" onClick={onClose} type="button">
          Put my phone away
        </button>
      </div>
    </div>
  );
}
