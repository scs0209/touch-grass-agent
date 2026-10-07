// One user session in headless Chrome against a fresh server (empty caches) and a fresh browser profile.
// Usage: node scripts/bench/browser.mjs <checkout> <server port> <web port>
// The web dev server on <web port> must proxy /api to <server port>.
import { spawn } from 'node:child_process';

const [root, serverPort, webPort] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn('npx', ['tsx', '--env-file-if-exists=.env', 'src/index.ts'], {
  cwd: `${root}/apps/server`,
  env: { ...process.env, PORT: serverPort },
  stdio: 'ignore',
  detached: true,
});
for (let i = 0; i < 100; i++) {
  await sleep(300);
  if (
    await fetch(`http://localhost:${serverPort}/api/health`).then(
      (r) => r.ok,
      () => false,
    )
  )
    break;
}

const cdpPort = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=/tmp/touch-grass-bench-profile-${Date.now()}`,
    '--hide-scrollbars',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(
    (r) => r.json(),
    () => [],
  );
  target = pages.find((page) => page.type === 'page');
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

let id = 0;
let errors = 0;
let requests = new Map();
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const { id: replyId, method, params } = message;
  if (replyId && pending.has(replyId)) {
    pending.get(replyId)(message);
    pending.delete(replyId);
  }
  const request = params?.requestId && requests.get(params.requestId);
  if (method === 'Runtime.exceptionThrown') errors++;
  if (method === 'Network.requestWillBeSent') {
    requests.set(params.requestId, { url: params.request.url, method: params.request.method });
  }
  if (method === 'Network.responseReceived' && request) {
    request.cached = params.response.fromDiskCache || params.response.fromMemoryCache;
  }
  if (method === 'Network.requestServedFromCache' && request) request.cached = true;
  if (method === 'Network.loadingFinished' && request) request.bytes = params.encodedDataLength;
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const callId = ++id;
    pending.set(callId, resolve);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
async function waitFor(expression, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`timed out: ${expression}`);
}
const click = (text) =>
  evaluate(
    `[...document.querySelectorAll('button, a')].find((el) => el.textContent.trim().includes(${JSON.stringify(text)}))?.click()`,
  );
const closePreview = async () => {
  await evaluate(`document.querySelector('[aria-label="Close preview"]')?.click()`);
  await sleep(800);
};

const CATEGORIES = [
  ['/api/trip-photos/', 'photoImage'],
  ['/api/trip-photos', 'photoSearch'],
  ['/api/recommend', 'recommend'],
  ['geocoding-api', 'cityLookup'],
];
function network() {
  const totals = { requests: 0, kb: 0 };
  for (const request of requests.values()) {
    if (request.method === 'OPTIONS' || /^(data|blob):/.test(request.url) || request.cached) continue;
    totals.requests++;
    totals.kb += (request.bytes ?? 0) / 1024;
    const category = CATEGORIES.find(([part]) => request.url.includes(part))?.[1];
    if (category) totals[category] = (totals[category] ?? 0) + 1;
  }
  totals.kb = Math.round(totals.kb);
  requests = new Map();
  return totals;
}

const results = {};
async function measure(name, start, readyExpression, timeoutMs) {
  requests = new Map();
  await start();
  const started = Date.now();
  await waitFor(readyExpression, timeoutMs);
  results[name] = { ms: Date.now() - started };
  return results[name];
}
const resultShown = `!!document.querySelector('.result h1')`;
const previewReady = `!document.querySelector('.preview-status.shimmer') && !!document.querySelector('.preview-backdrop')`;
const searchSeoul = `(() => {
  const input = document.querySelector('.city-form input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Seoul');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.city-form button').click();
})()`;
const skipQuestionnaire = `if (!sessionStorage.getItem('seeded')) {
  localStorage.setItem('touch-grass-preferences', ${JSON.stringify(JSON.stringify({ mode: 'ai' }))});
  sessionStorage.setItem('seeded', '1');
}`;

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 860, deviceScaleFactor: 2, mobile: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: skipQuestionnaire });
  await send('Page.navigate', { url: `http://localhost:${webPort}` });
  await waitFor(`!!document.querySelector('.city-form input')`, 30000);
  await click('60 min');

  (await measure('searchCity', () => evaluate(searchSeoul), resultShown)).net = network();
  await sleep(1500);

  const first = await measure('previewFirst', () => click('Preview your'), previewReady, 60000);
  const recordingFrom = Date.now();
  await waitFor(`!!document.querySelector('.preview-actions a[download]')`, 120000);
  first.untilVideoMs = first.ms + (Date.now() - recordingFrom);
  first.net = network();
  await closePreview();

  const reopen = await measure('previewReopen', () => click('Preview your'), previewReady, 60000);
  await sleep(1500);
  reopen.replayed = await evaluate(`!!document.querySelector('video.preview-canvas')`);
  reopen.net = network();
  await closePreview();

  await click('Ask again');
  await waitFor(`!!document.querySelector('.recent-pick')`);
  const pickRecent = () => evaluate(`document.querySelector('.recent-pick').click()`);
  (await measure('recentPlace', pickRecent, resultShown)).net = network();

  await click('Ask again');
  await waitFor(`!!document.querySelector('.city-form input')`);
  (await measure('sameCity', () => evaluate(searchSeoul), resultShown)).net = network();

  await send('Page.reload');
  await waitFor(`!!document.querySelector('.recent-pick')`, 30000);
  await pickRecent();
  await waitFor(resultShown);
  await sleep(1000);
  const afterReload = await measure('previewAfterReload', () => click('Preview your'), previewReady, 60000);
  await sleep(4000);
  afterReload.net = network();

  console.log(`RESULT ${JSON.stringify({ errors, ...results })}`);
} catch (error) {
  console.error(`FAILED ${error.message}`);
} finally {
  ws.close();
  chrome.kill();
  process.kill(-server.pid);
  process.exit(0);
}
