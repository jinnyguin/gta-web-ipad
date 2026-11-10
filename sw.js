const CACHE_NAME = 'playgta5-pwa-v1';

// Clean list of web client files relative to repository root
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './game.js',
  './loader.js',
  './io_worker.js',
  './wgpu_worker.js',
  './data-manifest.json',
  './shader-index.json',
  './mirror/playgta5.com/index.html',
  './mirror/playgta5.com/favicon.ico',
  './mirror/playgta5.com/robots.txt'
];

// 1. Install Event: Download and cache all web shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Caching Web Client Assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Clean up outdated cache stores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Clearing old cache store:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Serve cached assets offline with network fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
