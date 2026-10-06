import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { touchGrassAgent } from './agent.js';
import type { LatLon } from './geo.js';
import {
  askModel,
  buildResponse,
  fallbackRecommendation,
  getConditions,
  sanitize,
  type Conditions,
  type RecommendResponse,
  type Source,
} from './recommend.js';
import { recommendationSchema, recommendRequestSchema } from './schema.js';

const gathered = z.object({
  origin: z.custom<LatLon>(),
  conditions: z.custom<Conditions>(),
});

const answered = gathered.extend({
  modelRecommendation: recommendationSchema.nullable(),
});

const checked = gathered.extend({
  recommendation: recommendationSchema,
  source: z.enum(['model', 'fallback']),
});

const response = z.custom<RecommendResponse>();

const gatherConditions = createStep({
  id: 'gather-conditions',
  description: 'Weather, air quality, parks whose round trip fits the time, and Seoul bike stations around the person',
  inputSchema: recommendRequestSchema,
  outputSchema: gathered,
  execute: async ({ inputData: { lat, lon, availableMinutes, preferences } }) => {
    const origin = { lat, lon };
    return { origin, conditions: await getConditions(origin, availableMinutes, preferences ?? null) };
  },
});

const askGemma = createStep({
  id: 'ask-gemma',
  description: 'Local Gemma picks one activity, park, and outfit from the real candidates',
  inputSchema: gathered,
  outputSchema: answered,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent('touchGrassAgent') ?? touchGrassAgent;
    return { ...inputData, modelRecommendation: await askModel(agent, inputData.conditions) };
  },
});

const checkAnswer = createStep({
  id: 'check-answer',
  description: 'Drop ids the model invented, keep required extras, or fall back to rules',
  inputSchema: answered,
  outputSchema: checked,
  execute: async ({ inputData: { origin, conditions, modelRecommendation } }) => {
    const source: Source = modelRecommendation ? 'model' : 'fallback';
    return {
      origin,
      conditions,
      recommendation: sanitize(modelRecommendation ?? fallbackRecommendation(conditions), conditions),
      source,
    };
  },
});

const planRoute = createStep({
  id: 'plan-route',
  description: 'Round-trip walking route to the chosen park and outfits for running cold or warm',
  inputSchema: checked,
  outputSchema: response,
  execute: async ({ inputData: { origin, conditions, recommendation, source } }) =>
    buildResponse(origin, conditions, recommendation, source),
});

export const recommendWorkflow = createWorkflow({
  id: 'recommend',
  inputSchema: recommendRequestSchema,
  outputSchema: response,
})
  .then(gatherConditions)
  .then(askGemma)
  .then(checkAnswer)
  .then(planRoute)
  .commit();
