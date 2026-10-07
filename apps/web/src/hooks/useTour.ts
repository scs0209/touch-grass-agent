import { useCallback, useEffect, useState } from 'react';
import { TOURS } from '../constants/tour';
import { hasSeenTour, markTourSeen } from '../services/tourStorage';
import type { Box, TourId, TourStepId } from '../types/tour';

const findTarget = (name: TourStepId) => document.querySelector<HTMLElement>(`[data-tour="${name}"]`);

/** Walks through a tour once, keeping track of where the current step's element is on screen. */
export function useTour(id: TourId) {
  const [steps, setSteps] = useState<TourStepId[] | null>(null);
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Box | null>(null);
  const step = steps?.[index] ?? null;
  const count = steps?.length ?? 0;

  // A frame later, so the screen's own effects (like scrolling to the top) have run first.
  useEffect(() => {
    if (hasSeenTour(id)) return;
    const frame = requestAnimationFrame(() => {
      const present = TOURS[id].filter((candidate) => findTarget(candidate));
      if (present.length > 0) setSteps(present);
    });
    return () => cancelAnimationFrame(frame);
  }, [id]);

  useEffect(() => {
    const element = step && findTarget(step);
    if (!element) return;
    const measure = () => {
      const { top, left, width, height } = element.getBoundingClientRect();
      setTarget({ top, left, width, height });
    };
    const frame = requestAnimationFrame(() => {
      element.scrollIntoView({ block: 'center' });
      measure();
    });
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  const finish = useCallback(() => {
    markTourSeen(id);
    setSteps(null);
  }, [id]);

  const next = () => (index + 1 < count ? setIndex(index + 1) : finish());
  const back = () => setIndex(Math.max(0, index - 1));

  return { step, index, count, target, next, back, finish };
}
