import { z } from 'zod';
import { outfitSchema } from './outfit.js';

export const PACES = ['easy', 'active', 'workout'] as const;
export const INTERESTS = ['greenery', 'quiet', 'views', 'exercise', 'water'] as const;
export const COMPANIONS = ['alone', 'kids', 'dog', 'friends'] as const;

/** Answers from the first-visit questionnaire; every answer is optional. */
export const preferencesSchema = z.object({
  pace: z.enum(PACES).nullish(),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).default([]),
  company: z.enum(COMPANIONS).nullish(),
  cycling: z.boolean().nullish(),
});

export type Preferences = z.infer<typeof preferencesSchema>;
export type Interest = (typeof INTERESTS)[number];

const latLonSchema = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });
const placeNameSchema = z.string().min(1).max(200);
export const placeKindSchema = z.enum(['park', 'landmark']);

export const recommendRequestSchema = latLonSchema.extend({
  availableMinutes: z.number().int().min(10).max(240).default(30),
  /** Null when the person lets the AI decide everything. */
  preferences: preferencesSchema.nullish(),
  /** Places already suggested from this starting point, so asking again finds a different one. */
  excludePlaces: z.array(placeNameSchema).max(50).default([]),
  /** The kind of the last place suggested; asking again then tries the other kind first. */
  varyFrom: placeKindSchema.nullish(),
  /** A place picked again from the recent places, suggested on its own. */
  place: latLonSchema
    .extend({
      name: placeNameSchema,
      kind: placeKindSchema.default('park'),
      city: z.string().max(200).nullish(),
      area: z.string().max(200).nullish(),
      /** It was a public bike trip then, so it is ridden again when a nearby station has bikes. */
      byBike: z.boolean().default(false),
    })
    .nullish(),
  /** Places the person has checked in at around here, so new ones come first. */
  exploredPlaces: z.array(placeNameSchema).max(200).default([]),
  /** The language the suggestion's text comes back in; Gemma always answers in English first. */
  language: z.enum(['en', 'ko']).default('en'),
});

export type RecommendRequest = z.infer<typeof recommendRequestSchema>;
export type PinnedPlace = NonNullable<RecommendRequest['place']>;

export const geocodeQuerySchema = z.string().trim().min(1).max(100);

export const tripPhotosRequestSchema = z.object({
  /** Where the route meets the park; the same as destination when there is no route. */
  entrance: latLonSchema,
  destination: latLonSchema,
  placeName: z.string().min(1).max(200),
});

export const recommendationSchema = z.object({
  verdict: z.enum(['go', 'stay']),
  activity: z.string().min(1),
  durationMin: z.number().int().positive(),
  reason: z.string().min(1),
  safetyNote: z.string().nullish(),
  thingsToDo: z.array(z.string()).nullish(),
  placeId: z.string().nullish(),
  bikeStationId: z.string().nullish(),
  outfit: outfitSchema.nullish(),
});

export type Recommendation = z.infer<typeof recommendationSchema>;
