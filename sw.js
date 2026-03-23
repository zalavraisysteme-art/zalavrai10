// ════════════════════════════════════════════════════════════════════════════
//  ZALAVRAI — Service Worker v13 · GitHub Pages + Supabase
//  Cache offline + Background Sync + Periodic Sync
// ════════════════════════════════════════════════════════════════════════════

const CACHE         = 'zalavrai-v13';
const SYNC_TAG      = 'zalavrai-outbox';
const SYNC_TAG_PULL = 'zalavrai-pull';

// Ressources mises en cache (chemins relatifs → fonctionne partout)
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
];

// Domaines API — jamais mis en cache
const BYPASS_HOSTS = [
  'supabase.co',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
];

// ── Installation ─────────────────────────────────────────────────────────────
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE).catch(err => {
        console.warn('[SW] precache partial:', err.message);
      }))
      .then(() => self.skipWaiting())
  );
});

// ── Activation — nettoyage anciens caches ────────────────────────────────────
self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch — Cache-First statique, Network-Only API ───────────────────────────
self.addEventListener('fetch', evt => {
  const url = new URL(evt.request.url);

  // Bypass API externes
  if (BYPASS_HOSTS.some(h => url.hostname.includes(h))) return;

  // Bypass POST/PUT (outbox Supabase)
  if (evt.request.method !== 'GET') return;

  evt.respondWith(
    caches.match(evt.request).then(cached => {
      if (cached) return cached;
      return fetch(evt.request).then(response => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(evt.request, clone));
        }
        return response;
      }).catch(() => {
        if (evt.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ── Background Sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', evt => {
  if (evt.tag === SYNC_TAG || evt.tag === SYNC_TAG_PULL) {
    evt.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(clients => clients.forEach(c =>
          c.postMessage({ type: 'BG_SYNC', tag: evt.tag })
        ))
    );
  }
});

// ── Periodic Background Sync ─────────────────────────────────────────────────
self.addEventListener('periodicsync', evt => {
  if (evt.tag === 'zalavrai-periodic') {
    evt.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(clients => clients.forEach(c =>
          c.postMessage({ type: 'PERIODIC_SYNC' })
        ))
    );
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────
self.addEventListener('message', evt => {
  if (evt.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (evt.data?.type === 'CACHE_BUST')   caches.delete(CACHE).then(() => self.skipWaiting());
});
