import type { NamedPoint } from './geo';
import type { Fit, Outfit } from './outfit';
import type { WeatherConditions } from './weather';

export type ThingScene =
  | 'playground'
  | 'sports field'
  | 'running track'
  | 'outdoor gym'
  | 'benches'
  | 'drinking fountain'
  | 'viewpoint'
  | 'water'
  | 'sunset'
  | 'stretch'
  | 'season'
  | 'photo'
  | 'rest'
  | 'walk';

/** Must match Route in apps/server/src/conditions/route.ts. */
export interface Route {
  mode: 'foot' | 'bike';
  coordinates: [number, number][];
  destinationOnPath: [number, number];
  distanceM: number;
  /** The whole trip, including renting and returning the bike on a bike trip. */
  durationMin: number;
  rideMin: number;
  walkMin: number;
  /** First and last index in coordinates of the part on the bike; null on foot. */
  rideRange: [number, number] | null;
}

/** Must match PlaceKind in apps/server/src/conditions/places.ts. */
export type PlaceKind = 'park' | 'landmark';

export interface SuggestedPlace extends NamedPoint {
  kind: PlaceKind;
  city: string | null;
  /** District or neighborhood within the city, e.g. "Jongno-gu". */
  area: string | null;
  features: string[] | null;
  /** Named in exploredPlaces, i.e. the person checked in there before. */
  explored: boolean;
}

/** What /api/recommend takes besides the starting point, to find a different place or the same one again. */
export interface PlaceSearch {
  excludePlaces?: string[];
  varyFrom?: PlaceKind | null;
  place?: (Omit<SuggestedPlace, 'features' | 'explored'> & { byBike?: boolean }) | null;
  exploredPlaces?: string[];
}

export interface RecommendResponse {
  recommendation: {
    verdict: 'go' | 'stay';
    activity: string;
    durationMin: number;
    reason: string;
    thingsToDo: string[];
    safetyNote?: string | null;
  };
  /** One per item in recommendation.thingsToDo. */
  thingScenes: ThingScene[];
  outfits: { fit: Fit; outfit: Outfit }[];
  origin: { lat: number; lon: number };
  place: SuggestedPlace | null;
  route: Route | null;
  bikeStation: (NamedPoint & { bikesAvailable: number }) | null;
  source: 'model' | 'fallback';
  conditions: WeatherConditions;
}

/** Must match TripPhoto in apps/server/src/conditions/photos.ts. */
export interface TripPhoto {
  key: string;
  kind: 'arrival' | 'place';
  source: 'mapillary' | 'wikimedia';
  creator: string;
  license: string;
  capturedAt: string | null;
}

export interface TripPhotos {
  arrival: TripPhoto | null;
  place: TripPhoto[];
}
