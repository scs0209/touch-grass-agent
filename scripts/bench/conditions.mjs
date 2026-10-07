// Only the data-gathering step (weather, air, places, features, routes; no Gemma) in one fresh process.
// Usage (from <checkout>/apps/server): npx tsx --env-file-if-exists=.env scripts/bench/conditions.mjs <checkout>
const [root] = process.argv.slice(2);
const realFetch = globalThis.fetch;
let hosts = [];
globalThis.fetch = async (input, init) => {
  hosts.push(new URL(typeof input === 'string' || input instanceof URL ? input : input.url).host);
  return realFetch(input, init);
};

const { getConditions } = await import(`${root}/apps/server/src/recommend.ts`);
const origin = { lat: 37.566, lon: 126.9784 };
const results = {};

async function scenario(name, run) {
  hosts = [];
  const started = performance.now();
  let value = null;
  let ok = true;
  try {
    value = await run();
  } catch {
    ok = false;
  }
  results[name] = { ms: Math.round(performance.now() - started), upstream: hosts.length, hosts, ok };
  return value;
}

const first = await scenario('cold', () => getConditions(origin, 60, null));
await scenario('repeat', () => getConditions(origin, 60, null));
const park = first?.nearbyParks?.[0];
await scenario('another', () =>
  getConditions(origin, 60, null, { excludePlaces: park ? [park.name] : [], varyFrom: park?.kind ?? null }),
);
if (park) {
  const { features: _f, roundTripMin: _r, bikeOnly: _b, bikeTripMin: _t, ...place } = park;
  await scenario('recent', () => getConditions(origin, 60, null, { place: { ...place, byBike: false } }));
}
await scenario('nearby', () => getConditions({ lat: 37.5687, lon: 126.9784 }, 60, null));

console.log(`RESULT ${JSON.stringify(results)}`);
process.exit(0);
