// ============================================================
//  VVS Rotselaar — Service Worker
//  Strategie:
//    • Statische assets  → Cache First (snel)
//    • HTML pagina's     → Network First met fallback
//    • Firebase / API    → Network Only (altijd live data)
// ============================================================

const CACHE_NAME    = 'vvs-static-v1';
const PAGES_CACHE   = 'vvs-pages-v1';
const OFFLINE_PAGE  = '/offline.html';

// Statische assets die meteen gecached worden bij installatie
const STATIC_ASSETS = [
  '/manifest.json',
  '/assets/logo.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
];

// HTML pagina's (network first, met cache-fallback)
const HTML_PAGES = [
  '/index.html',
  '/contact.html',
  '/evenementen.html',
  '/galerij.html',
  '/kalender.html',
  '/live.html',
  '/login.html',
  '/privacy.html',
  '/speler.html',
  '/sponsors.html',
  '/veteranen.html',
  '/werklijst.html',
  '/zaterdag.html',
  '/zondag.html',
  '/offline.html',
];

// Domeinen die NOOIT gecached worden (Firebase, externe APIs)
const NETWORK_ONLY_DOMAINS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebasestorage.googleapis.com',
  'www.gstatic.com',
];

// ── Install: pre-cache statische assets ─────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_ASSETS).catch(err =>
        console.warn('[SW] Pre-cache gedeeltelijk mislukt:', err)
      )
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: verwijder verouderde caches ────────────────────
self.addEventListener('activate', event => {
  const validCaches = [CACHE_NAME, PAGES_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => !validCaches.includes(k)).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: strategieën per type request ─────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Altijd network voor Firebase en externe diensten
  if (NETWORK_ONLY_DOMAINS.some(d => url.hostname.includes(d))) {
    return; // val door naar browser (network only)
  }

  // 2. Alleen GET requests cachen
  if (request.method !== 'GET') return;

  // 3. HTML pagina's: Network First
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  // 4. CSS / JS / Fonts / Images: Cache First
  if (
    url.pathname.match(/\.(css|js|woff2?|ttf|otf|svg|png|jpg|jpeg|gif|webp|ico)$/)
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 5. Al het overige: network, geen cache
});

// ── Cache First (statische assets) ──────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408 });
  }
}

// ── Network First (HTML pagina's) ────────────────────────────
async function networkFirstHtml(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline: probeer cache
    const cached = await caches.match(request);
    if (cached) return cached;
    // Geen cache: toon offline pagina
    const offline = await caches.match(OFFLINE_PAGE);
    return offline || new Response('<h1>Offline</h1>', {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// ── Achtergrond sync (toekomstig gebruik) ────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
