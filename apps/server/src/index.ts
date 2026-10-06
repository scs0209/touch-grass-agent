import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { OLLAMA_MODEL } from './agent.js';
import { recommend } from './mastra.js';
import { recommendRequestSchema } from './schema.js';

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true, model: OLLAMA_MODEL }));

app.post('/api/recommend', async (c) => {
  const parsed = recommendRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid location or preferences' }, 400);

  try {
    return c.json(await recommend(parsed.data));
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Could not check the conditions right now. Try again in a minute.' }, 502);
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Server listening on http://localhost:${port} (model: ${OLLAMA_MODEL})`);
});
