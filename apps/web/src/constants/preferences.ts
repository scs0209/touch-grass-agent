import type { Company, Interest, Pace, Preferences } from '../types/preferences';

export const PACE_LABELS: Record<Pace, string> = {
  easy: 'Easy and relaxed',
  active: 'A bit active',
  workout: 'Get my heart rate up',
};

export const INTEREST_LABELS: Record<Interest, string> = {
  greenery: 'Greenery',
  quiet: 'Quiet spots',
  views: 'Views and photos',
  exercise: 'Exercise',
  water: 'Water',
};

export const COMPANY_LABELS: Record<Company, string> = {
  alone: 'Just me',
  kids: 'With kids',
  dog: 'With a dog',
  friends: 'With friends',
};

export const CYCLING_LABELS = { yes: 'Happy to ride a bike', no: 'Walking only' };

export const EMPTY_PREFERENCES: Preferences = { pace: null, interests: [], company: null, cycling: null };
