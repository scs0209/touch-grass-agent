import type { TourId, TourStepId } from '../types/tour';

/** Shown once each: the home tour after the questionnaire, the result tour on the first suggestion. */
export const TOURS: Record<TourId, TourStepId[]> = {
  home: ['minutes', 'here', 'city', 'explorations'],
  result: ['preview', 'directions', 'check-in'],
};
