// Keeps the app itself available offline, so checking in works in a park with no signal or while the Mac is asleep.
// Suggestions (/api) always need the network, and map tiles, photos, and other sites are left alone.
const CACHE = 'touch-grass-app';
const SHELL = '/index.html';
/** A phone can wait a long time for a Mac that's asleep; past this, the saved copy opens instead. */
const NETWORK_TIMEOUT_MS = 4000;

/** The server sends `Vary: Origin`, and module scripts send an Origin header that the saved requests lack. */
const MATCH = { ignoreVary: true };

const assetsIn = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);

/** The page's own scripts and styles, so the saved page can start; each build gives them new names. */
async function cacheAssets(cache, html) {
  for (const url of assetsIn(html)) {
    if (!(await cache.match(url, MATCH))) await cache.add(url);
  }
}

/** Lazy-loaded chunks aren't named in the page, so old files are only dropped once the page itself changes. */
async function dropOldBuild(cache, previousHtml, html) {
  const current = assetsIn(html);
  if (assetsIn(previousHtml).join() === current.join()) return;
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/assets/') && !current.includes(pathname)) await cache.delete(request, MATCH);
  }
}

async function saveShell(cache, response) {
  const html = await response.clone().text();
  const previousHtml = (await (await cache.match(SHELL, MATCH))?.text()) ?? '';
  await cache.put(SHELL, response);
  await dropOldBuild(cache, previousHtml, html);
  await cacheAssets(cache, html);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch('/', { cache: 'no-cache' });
      if (response.ok) await saveShell(await caches.open(CACHE), response);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function pageFromNetworkFirst(event) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(event.request, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
    if (response.ok) event.waitUntil(saveShell(cache, response.clone()));
    return response;
  } catch {
    return (await cache.match(SHELL, MATCH)) ?? Response.error();
  }
}

/** File names under /assets change with their content, so a saved copy is never stale. */
async function fileFromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request, MATCH);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') event.respondWith(pageFromNetworkFirst(event));
  else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fluent-emoji/')) {
    event.respondWith(fileFromCacheFirst(request));
  }
});
