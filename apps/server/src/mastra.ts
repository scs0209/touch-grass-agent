import { Mastra } from '@mastra/core/mastra';
import { Observability } from '@mastra/observability';
import { SentryExporter } from '@mastra/sentry';
import { touchGrassAgent } from './agent.js';
import type { RecommendRequest } from './schema.js';
import { recommendWorkflow } from './workflow.js';

const observability = process.env.SENTRY_DSN
  ? new Observability({
      configs: {
        sentry: {
          serviceName: 'touch-grass-agent',
          exporters: [new SentryExporter({ tracesSampleRate: 1.0 })],
        },
      },
    })
  : undefined;

export const mastra = new Mastra({
  agents: { touchGrassAgent },
  workflows: { recommendWorkflow },
  observability,
});

export async function recommend(request: RecommendRequest) {
  const run = await mastra.getWorkflow('recommendWorkflow').createRun();
  const result = await run.start({ inputData: request });
  if (result.status !== 'success') {
    throw result.status === 'failed' ? result.error : new Error(`Workflow ended with status ${result.status}`);
  }
  return result.result;
}
