import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { OLLAMA_MODEL } from './agent.js';
import { fetchTripPhoto, getTripPhotos, PHOTO_CACHE_MS } from './conditions/photos.js';
import { geocodeCity, streetAddress } from './conditions/places.js';
import { recommend } from './mastra.js';
import {
  geocodeQuerySchema,
  recommendRequestSchema,
  streetAddressQuerySchema,
  tripPhotosRequestSchema,
} from './schema.js';

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

app.get('/api/geocode', async (c) => {
  const parsed = geocodeQuerySchema.safeParse(c.req.query('name'));
  if (!parsed.success) return c.json({ error: 'Invalid city name' }, 400);

  try {
    const found = await geocodeCity(parsed.data);
    return found ? c.json(found) : c.json({ error: 'City not found' }, 404);
  } catch (error) {
    console.error(error);
    return c.json({ error: 'Could not look up the city' }, 502);
  }
});

app.get('/api/street-address', async (c) => {
  const parsed = streetAddressQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid location' }, 400);

  try {
    return c.json({ address: await streetAddress(parsed.data) });
  } catch (error) {
    console.error(error);
    return c.json({ address: null });
  }
});

app.post('/api/trip-photos', async (c) => {
  const parsed = tripPhotosRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Invalid trip' }, 400);

  const { entrance, destination, placeName } = parsed.data;
  try {
    return c.json({ photos: await getTripPhotos(entrance, destination, placeName, c.req.raw.signal) });
  } catch (error) {
    console.error(error);
    return c.json({ photos: null });
  }
});

/** Serves photos from this origin so the preview canvas can record them. */
app.get('/api/trip-photos/:key', async (c) => {
  const photo = await fetchTripPhoto(c.req.param('key'));
  if (!photo) return c.json({ error: 'Photo unavailable' }, 404);
  // Keys are derived from the photo's source, so a key always means the same image.
  return c.body(photo.bytes, 200, {
    'Content-Type': photo.type,
    'Cache-Control': `private, max-age=${PHOTO_CACHE_MS / 1000}, immutable`,
  });
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Server listening on http://localhost:${port} (model: ${OLLAMA_MODEL})`);
});
