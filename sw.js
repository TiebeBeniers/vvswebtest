// ============================================================
//  VVS Rotselaar — Service Worker (subdirectory: /vvsrotselaar/)
// ============================================================

const BASE        = '/vvsrotselaar';
const CACHE_NAME  = 'vvs-static-v19'; //Last updated 26/05/2026 - 17:45
const PAGES_CACHE = 'vvs-pages-v19';
const OFFLINE_URL = BASE + '/offline.html';

const STATIC_ASSETS = [
  BASE + '/manifest.json',
  BASE + '/assets/logo.png',
  BASE + '/assets/icons/icon-192.png',
  BASE + '/assets/icons/icon-512.png',
  BASE + '/assets/icons/apple-touch-icon.png',
  BASE + '/offline.html',
];

const HTML_PAGES = [
  BASE + '/index.html',
  BASE + '/contact.html',
  BASE + '/evenementen.html',
  BASE + '/galerij.html',
  BASE + '/kalender.html',
  BASE + '/live.html',
  BASE + '/login.html',
  BASE + '/privacy.html',
  BASE + '/speler.html',
  BASE + '/sponsors.html',
  BASE + '/veteranen.html',
  BASE + '/werklijst.html',
  BASE + '/zaterdag.html',
  BASE + '/zondag.html',
];

const NETWORK_ONLY_DOMAINS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebasestorage.googleapis.com',
  'www.gstatic.com',
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(e => console.warn('[SW] Pre-cache:', e)))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => ![CACHE_NAME, PAGES_CACHE].includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Firebase / externe diensten → altijd network
  if (NETWORK_ONLY_DOMAINS.some(d => url.hostname.includes(d))) return;
  if (request.method !== 'GET') return;

  // HTML pagina's → Network First
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  // Statische assets → Cache First
  if (url.pathname.match(/\.(css|js|woff2?|ttf|svg|png|jpg|jpeg|gif|webp|ico)$/)) {
    event.respondWith(cacheFirst(request));
    return;
  }
});

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

async function networkFirstHtml(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match(OFFLINE_URL);
  }
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
