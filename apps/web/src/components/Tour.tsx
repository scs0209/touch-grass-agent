import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useTour } from '../hooks/useTour';
import { useMessages } from '../i18n';
import type { TourId } from '../types/tour';
import { placeTooltip } from '../utils/tour';

/** Room around the highlighted element, so its border and shadow stay inside the bright area. */
const SPOTLIGHT_PAD = 6;

/** A step-by-step tour that dims the screen and points a card at one element at a time. */
export function Tour({ id }: { id: TourId }) {
  const t = useMessages().tour;
  const { step, index, count, target, next, back, finish } = useTour(id);
  const tipRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const shown = step !== null && target !== null;
  const placed = shown && size !== null;
  useEscapeKey(finish, shown);

  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!shown || !step || !tip) return;
    setSize({ width: tip.offsetWidth, height: tip.offsetHeight });
  }, [shown, step]);

  // The card stays hidden until it has a size, and a hidden button can't take focus.
  useEffect(() => {
    if (placed && step) nextRef.current?.focus();
  }, [placed, step]);

  if (!step || !target) return null;

  const place = size && placeTooltip(target, size, { width: window.innerWidth, height: window.innerHeight });
  const tipStyle: CSSProperties = place
    ? ({ top: place.top, left: place.left, '--arrow-x': `${place.arrowX}px` } as CSSProperties)
    : { visibility: 'hidden' };

  return (
    <div className="tour">
      <div
        className="tour-spotlight"
        style={{
          top: target.top - SPOTLIGHT_PAD,
          left: target.left - SPOTLIGHT_PAD,
          width: target.width + 2 * SPOTLIGHT_PAD,
          height: target.height + 2 * SPOTLIGHT_PAD,
        }}
      />
      <div
        ref={tipRef}
        className={`panel tour-tip ${place?.side ?? ''}`}
        style={tipStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
      >
        <p className="tour-count">
          {index + 1} / {count}
        </p>
        <h2 id="tour-title">{t.steps[step].title}</h2>
        <p id="tour-body" className="muted small">
          {t.steps[step].body}
        </p>
        <div className="tour-actions">
          <button className="link" onClick={finish} type="button">
            {t.skip}
          </button>
          {index > 0 && (
            <button className="secondary" onClick={back} type="button">
              {t.back}
            </button>
          )}
          <button ref={nextRef} className="primary" onClick={next} type="button">
            {index + 1 === count ? t.done : t.next}
          </button>
        </div>
      </div>
    </div>
  );
}
