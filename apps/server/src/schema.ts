import { z } from 'zod';
import { outfitSchema } from './outfit.js';

export const recommendRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  availableMinutes: z.number().int().min(10).max(240).default(30),
});

export type RecommendRequest = z.infer<typeof recommendRequestSchema>;

export const recommendationSchema = z.object({
  verdict: z.enum(['go', 'stay']),
  activity: z.string().min(1),
  durationMin: z.number().int().positive(),
  reason: z.string().min(1),
  safetyNote: z.string().nullish(),
  placeId: z.string().nullish(),
  bikeStationId: z.string().nullish(),
  outfit: outfitSchema.nullish(),
});

export type Recommendation = z.infer<typeof recommendationSchema>;
