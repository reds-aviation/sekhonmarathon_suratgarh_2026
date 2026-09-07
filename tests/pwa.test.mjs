import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);

void test('PWA serves current pages, isolates private requests and provides a public offline fallback', async () => {
const origin = 'https://reds-aviation.github.io';
const base = `${origin}/sekhonmarathon_suratgarh_2026/`;
const events = {};
const buckets = new Map();
const network = [];
let offline = false;
let checks = 0;
const key = (request) => typeof request === 'string' ? request : request.url;
const caches = {
  async open(name) {
    if (!buckets.has(name)) buckets.set(name, new Map());
    const bucket = buckets.get(name);
    return {
      async addAll(requests) {
        for (const request of requests) {
          assert.equal(request.credentials, 'omit');
          bucket.set(key(request), new Response(request.url.endsWith('offline.html') ? 'CONNECTION NEEDED' : 'ICON'));
        }
      },
      async match(request) { return bucket.get(key(request))?.clone(); },
    };
  },
  async keys() { return [...buckets.keys()]; },
  async delete(name) { return buckets.delete(name); },
};
const sandbox = {
  URL, Request, Response, Set, Promise, caches,
  self: { location: { href: `${base}service-worker.js` }, addEventListener: (name, cb) => { events[name] = cb; } },
  fetch: async (request, options) => {
    network.push({ url: key(request), options });
    if (offline) throw new TypeError('Offline');
    return new Response('FRESH NETWORK');
  },
};
vm.runInNewContext(await readFile(new URL('public/service-worker.js', root), 'utf8'), sandbox);
let pending = Promise.resolve();
events.install({ waitUntil: (promise) => { pending = Promise.resolve(promise); } });
await pending;
const stored = [...buckets.get('desert-braves-public-v1').keys()];
assert.equal(stored.length, 4); checks++;
assert(stored.every((url) => url === `${base}offline.html` || /\/assets\/(app-icon-(192|512)|apple-touch-icon-180)\.png$/.test(url))); checks++;
assert(!stored.includes(base)); checks++;

async function request(url, fields = {}) {
  let response;
  events.fetch({
    request: { url, method: 'GET', mode: 'cors', headers: new Headers(), ...fields },
    respondWith: (value) => { response = value; },
  });
  return response === undefined ? undefined : Promise.resolve(response);
}
const fresh = await request(base, { mode: 'navigate' });
assert.equal(await fresh.text(), 'FRESH NETWORK'); checks++;
assert.equal(network.at(-1).options.cache, 'no-store'); checks++;
assert.equal(buckets.get('desert-braves-public-v1').size, 4); checks++;

for (const [url, fields] of /** @type {Array<[string, RequestInit]>} */ ([
  ['https://project.supabase.co/rest/v1/registrations', {}],
  ['https://project.supabase.co/storage/v1/object/sign/receipts/private.png?token=secret', {}],
  [`${base}api/registrations`, {}],
  [`${base}assets/receipt.png`, {}],
  [`${base}certificates/participant.pdf`, {}],
  [`${base}assets/app-icon-192.png?token=secret`, {}],
  [base, { method: 'POST', mode: 'navigate' }],
  [base, { mode: 'navigate', headers: new Headers({ Authorization: 'Bearer test' }) }],
  [`${base}assets/app-icon-192.png`, { headers: new Headers({ Range: 'bytes=0-10' }) }],
  [`${origin}/other-project/`, { mode: 'navigate' }],
])) {
  assert.equal(await request(url, fields), undefined, `Should bypass ${url}`); checks++;
}

offline = true;
assert.equal(await (await request(base, { mode: 'navigate' })).text(), 'CONNECTION NEEDED'); checks++;
assert.equal(await (await request(`${base}assets/app-icon-192.png`)).text(), 'ICON'); checks++;
buckets.set('desert-braves-public-v0', new Map());
buckets.set('unrelated-project-cache', new Map());
events.activate({ waitUntil: (promise) => { pending = Promise.resolve(promise); } });
await pending;
assert(!buckets.has('desert-braves-public-v0')); checks++;
assert(buckets.has('desert-braves-public-v1')); checks++;
assert(buckets.has('unrelated-project-cache')); checks++;
buckets.get('desert-braves-public-v1').delete(`${base}offline.html`);
const unavailable = await request(base, { mode: 'navigate' });
assert.equal(unavailable.status, 503); checks++;
assert.equal(unavailable.headers.get('Cache-Control'), 'no-store'); checks++;
const manifest = JSON.parse(await readFile(new URL('public/manifest.webmanifest', root), 'utf8'));
const manifestUrl = new URL('manifest.webmanifest', base);
for (const field of ['id', 'scope', 'start_url']) {
  assert.equal(new URL(manifest[field], manifestUrl).href, base); checks++;
}
assert.equal(manifest.display, 'standalone'); checks++;
assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']); checks++;
assert.deepEqual(manifest.shortcuts.map((shortcut) => shortcut.url), ['./#races', './#guide']); checks++;
assert.equal(checks, 29, 'Keep all cache/privacy/manifest regression assertions');
});

void test('only the Pages entry registers the public offline worker', async () => {
  const [client, pwa] = await Promise.all([
    readFile(new URL('app/client.tsx', root), 'utf8'),
    readFile(new URL('app/pwa.ts', root), 'utf8'),
  ]);
  assert.match(client, /VITE_BUILD_TARGET === 'pages'/u);
  assert.match(client, /import\('\.\/pwa'\)/u);
  assert.doesNotMatch(client, /import \{ registerPublicOfflineWorker \}/u);
  assert.match(pwa, /VITE_BUILD_TARGET !== 'pages'/u);
});
