import type { PlaceKind } from './api';
import type { LatLon } from './geo';

/** A check-in made on site at a suggested place. */
export interface Visit extends LatLon {
  name: string;
  kind: PlaceKind;
  city: string | null;
  area: string | null;
  /** When the person checked in, in milliseconds since the epoch. */
  at: number;
}

export interface Mission {
  id: string;
  title: string;
  progress: number;
  goal: number;
  /** Starts again each day or week; the others stay done once reached and become badges. */
  repeats: boolean;
}

export interface Badge {
  id: string;
  title: string;
  detail: string;
}

export interface ExploreStats {
  places: number;
  cities: number;
  /** Weeks in a row, up to this one or the last, with at least one check-in. */
  weekStreak: number;
  thisWeek: number;
  lastWeek: number;
  bestWeek: number;
}
