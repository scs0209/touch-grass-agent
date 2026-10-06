import { Mastra } from '@mastra/core/mastra';
import { touchGrassAgent } from './agent.js';
import type { RecommendRequest } from './schema.js';
import { recommendWorkflow } from './workflow.js';

export const mastra = new Mastra({
  agents: { touchGrassAgent },
  workflows: { recommendWorkflow },
});

export async function recommend(request: RecommendRequest) {
  const run = await mastra.getWorkflow('recommendWorkflow').createRun();
  const result = await run.start({ inputData: request });
  if (result.status !== 'success') {
    throw result.status === 'failed' ? result.error : new Error(`Workflow ended with status ${result.status}`);
  }
  return result.result;
}
