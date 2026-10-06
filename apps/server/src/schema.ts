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

export const recommendRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  availableMinutes: z.number().int().min(10).max(240).default(30),
  /** Null when the person lets the AI decide everything. */
  preferences: preferencesSchema.nullish(),
});

export type RecommendRequest = z.infer<typeof recommendRequestSchema>;

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
