/* Public offline information only. Never store a registration page or user data. */
const CACHE_PREFIX = 'desert-braves-public-';
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const BASE_URL = new URL('./', self.location.href);
const OFFLINE_URL = new URL('offline.html', BASE_URL).href;
const PUBLIC_FILES = [
  OFFLINE_URL,
  new URL('assets/app-icon-192.png', BASE_URL).href,
  new URL('assets/app-icon-512.png', BASE_URL).href,
  new URL('assets/apple-touch-icon-180.png', BASE_URL).href,
];
const PUBLIC_URLS = new Set(PUBLIC_FILES);
const PAGE_PATHS = new Set([
  BASE_URL.pathname,
  `${BASE_URL.pathname}index.html`,
  `${BASE_URL.pathname}offline.html`,
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PUBLIC_FILES.map((url) => new Request(url, {
        cache: 'reload',
        credentials: 'omit',
      }))),
    ),
  );
  // Use the normal lifecycle so an open information page is not interrupted.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    )),
  );
});

async function freshPageOrOffline(request) {
  try {
    // Also bypass the browser HTTP cache: opening the site needs current event guidance.
    // The response is returned directly, never written to Cache Storage.
    return await fetch(request, { cache: 'no-store' });
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const offline = await cache.match(OFFLINE_URL);
    return offline || new Response(
      'You are offline. Reconnect to view the latest event guidance. Organiser: 8838463776 or 7027964880.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Non-public, cross-origin and non-GET requests always use their normal
  // network path. A file-extension rule would be too permissive.
  if (request.method !== 'GET'
      || url.origin !== BASE_URL.origin
      || !url.pathname.startsWith(BASE_URL.pathname)
      || request.headers.has('Authorization')
      || request.headers.has('Range')) return;

  if (request.mode === 'navigate' && PAGE_PATHS.has(url.pathname)) {
    event.respondWith(freshPageOrOffline(request));
    return;
  }

  // Only these explicitly named public icons and the offline document exist
  // in our cache. URLs with a query string are deliberately not matched.
  if (PUBLIC_URLS.has(url.href)) {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then((cache) => cache.match(request))
        .then((cached) => cached || fetch(request)),
    );
  }
});
