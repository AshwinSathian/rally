// The page: network first so a deploy shows up at once, but give up after 3 s on a weak
// connection and use the cached copy. Everything else: serve from cache and refresh in the
// background, so a changed icon or manifest arrives on the next visit.
const CACHE = 'rally-v2';
const CORE = ['/', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const keep = (req, res) => (res.ok ? caches.open(CACHE).then((c) => c.put(req, res)) : Promise.resolve());
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    const net = fetch(req);
    e.waitUntil(net.then((r) => keep('/', r.clone())).catch(() => {}));
    const late = new Promise((res) => setTimeout(res, 3000)).then(() => caches.match('/')).then((hit) => hit ?? net);
    e.respondWith(Promise.race([net.then((r) => (r.ok ? r : caches.match('/').then((hit) => hit ?? r))), late]).catch(() => caches.match('/')));
    return;
  }
  const net = fetch(req);
  e.waitUntil(net.then((r) => keep(req, r.clone())).catch(() => {}));
  e.respondWith(caches.match(req).then((hit) => hit ?? net));
});
