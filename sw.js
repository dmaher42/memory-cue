// Memory Cue - Basic Service Worker
// Minimal service worker with install/activate handlers and basic fetch pass-through

const CACHE_NAME = 'memory-cue-cache-v1';
const urlsToCache = [
  '/',
  '/mobile.html',
  '/index.html', 
  '/css/app.css',
  '/manifest.webmanifest'
];

// Install event - cache important resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - basic pass-through with cache fallback
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If we got a response, clone it and cache it
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseClone);
            });
        }
        return response;
      })
      .catch(() => {
        // If fetch fails, try to serve from cache
        return caches.match(event.request);
      })
  );
});