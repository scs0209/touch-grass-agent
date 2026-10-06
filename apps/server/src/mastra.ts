import { Mastra } from '@mastra/core/mastra';
import { Observability } from '@mastra/observability';
import { SentryExporter } from '@mastra/sentry';
import { touchGrassAgent } from './agent.js';
import type { RecommendRequest } from './schema.js';
import { recommendWorkflow } from './workflow.js';

type SentryOptions = NonNullable<NonNullable<ConstructorParameters<typeof SentryExporter>[0]>['options']>;

/** The Seoul bike API takes its key in the URL path, and Sentry records outgoing request URLs. */
function redactSeoulKey<T>(value: T): T {
  const key = process.env.SEOUL_OPEN_API_KEY;
  if (!key || typeof value !== 'string') return value;
  return value.replaceAll(encodeURIComponent(key), '[SEOUL_OPEN_API_KEY]').replaceAll(key, '[SEOUL_OPEN_API_KEY]') as T;
}

function redactValues<T extends Record<string, unknown> | undefined>(record: T): T {
  if (!record) return record;
  return Object.fromEntries(Object.entries(record).map(([name, value]) => [name, redactSeoulKey(value)])) as T;
}

const sentryOptions: SentryOptions = {
  beforeSendSpan: (span) => ({ ...span, description: redactSeoulKey(span.description), data: redactValues(span.data) }),
  beforeBreadcrumb: (breadcrumb) => ({
    ...breadcrumb,
    message: redactSeoulKey(breadcrumb.message),
    data: redactValues(breadcrumb.data),
  }),
};

const observability = process.env.SENTRY_DSN
  ? new Observability({
      configs: {
        sentry: {
          serviceName: 'touch-grass-agent',
          exporters: [
            new SentryExporter({
              tracesSampleRate: 1.0,
              options: sentryOptions,
            }),
          ],
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
