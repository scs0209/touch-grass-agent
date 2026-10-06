import type { Route, ThingScene } from './api';
import type { LatLon, NamedPoint } from './geo';
import type { OutfitItem } from './outfit';
import type { WeatherConditions } from './weather';

/** Everything the walk preview needs, taken from a recommendation. */
export interface StoryInput {
  durationMin: number;
  placeName: string;
  features: string[];
  origin: LatLon;
  destination: LatLon;
  route: Route | null;
  /** Set when the suggestion is a bike ride from this station. */
  bikeStation: NamedPoint | null;
  things: { text: string; scene: ThingScene }[];
  outfitItems: OutfitItem[];
  conditions: WeatherConditions;
}
