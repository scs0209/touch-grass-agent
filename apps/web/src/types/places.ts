import type { PlaceKind } from './api';
import type { LatLon } from './geo';

/** Where suggestions start from: the person's location, a city they typed, or a recent place's start. */
export interface SearchOrigin extends LatLon {
  /** "your location", or the city name, e.g. "Seoul". */
  label: string;
  /** The city typed in, when there was one. */
  city: string | null;
}

/** A place that was suggested, kept so it can be picked again later. */
export interface RecentPlace extends LatLon {
  name: string;
  kind: PlaceKind;
  city: string | null;
  area: string | null;
  /** Where the walk started when it was suggested; picking it again starts there. */
  origin: SearchOrigin;
  /** When it was last suggested, in milliseconds since the epoch. */
  viewedAt: number;
}
