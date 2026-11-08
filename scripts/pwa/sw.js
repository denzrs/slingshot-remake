// The service worker, as a template: `scripts/pwa/worker.ts` fills in the cache name and the file list (the two
// placeholders below, each written once in the code) at build time and vite.config.ts emits the result as `sw.js` at the
// build root. Every URL is relative to the worker's scope, so the same
// file works at the root of a host and under a sub-path such as /slingshot-remake/.
//
// What it does: keeps the whole build in a cache named after its file list, answers the game's own pages and files from
// it (local play needs no network), and leaves everything else (the relay, the leaderboard) alone. A new build installs
// beside the old one and WAITS: the page decides when to switch (the "new version" notice), because an old client
// against a new relay is a broken match.

const CACHE = '__CACHE__';
const FILES = __FILES__;
const PREFIX = 'slingshot-';

const here = (path) => new URL(path, self.registration.scope).href;

// The cache holds one answer per URL, so a header the host varies on (Origin, Accept-Encoding) must not make a stored file
// miss: a page's own script and style requests are CORS requests and carry other headers than the install's fetch did.
const lookup = (request, options) => caches.match(request, { ignoreVary: true, ...options });

self.addEventListener('install', (event) => {
  // `reload` goes round the browser's own HTTP cache, so a half-old file can never end up in the new cache.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(here(file), { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') void self.skipWaiting();
});

/** Which page of the build a navigation asks for, or null when it is not one of ours. */
function pageFor(url) {
  const path = url.href.slice(self.registration.scope.length);
  if (path === '' || path === 'index.html') return 'index.html';
  if (path === 'stats/' || path === 'stats/index.html') return 'stats/index.html';
  return null;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    // `stats` without its slash would resolve the page's `../` links wrongly; the host redirects it, so do the same offline.
    if (url.href.slice(self.registration.scope.length) === 'stats') {
      event.respondWith(Response.redirect(here('stats/') + url.search, 302));
      return;
    }
    const page = pageFor(url);
    if (!page) return;
    event.respondWith(lookup(here(page)).then((cached) => cached || fetch(request)));
    return;
  }
  event.respondWith(lookup(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)));
});
