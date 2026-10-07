// Full suggestion requests in one fresh process (empty caches), timed and counted per scenario.
// Usage (from <checkout>/apps/server): npx tsx --env-file-if-exists=.env scripts/bench/server.mjs <checkout>
const [root] = process.argv.slice(2);
const realFetch = globalThis.fetch;
let calls = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  calls.push(url.port === '11434' ? 'gemma' : url.host);
  return realFetch(input, init);
};

const { recommend } = await import(`${root}/apps/server/src/mastra.ts`);
const base = {
  lat: 37.566,
  lon: 126.9784,
  availableMinutes: 60,
  preferences: null,
  excludePlaces: [],
  varyFrom: null,
  place: null,
};
const results = {};

async function scenario(name, run) {
  calls = [];
  const started = performance.now();
  let value = null;
  let ok = true;
  try {
    value = await run();
  } catch {
    ok = false;
  }
  const gemma = calls.filter((host) => host === 'gemma').length;
  results[name] = { ms: Math.round(performance.now() - started), upstream: calls.length - gemma, gemma, ok };
  return Array.isArray(value) ? value[0] : value;
}

const first = await scenario('cold', () => recommend(base));
await scenario('repeat', () => recommend(base));
await scenario('another', () =>
  recommend({ ...base, excludePlaces: first?.place ? [first.place.name] : [], varyFrom: first?.place?.kind ?? null }),
);
if (first?.place) {
  const { features: _features, ...place } = first.place;
  await scenario('recent', () => recommend({ ...base, place: { ...place, byBike: false } }));
}
await scenario('nearby', () => recommend({ ...base, lat: 37.5687 }));
const elsewhere = { ...base, lat: 37.5512, lon: 126.9882 };
await scenario('concurrent3', () => Promise.all([recommend(elsewhere), recommend(elsewhere), recommend(elsewhere)]));

console.log(`RESULT ${JSON.stringify(results)}`);
process.exit(0);
