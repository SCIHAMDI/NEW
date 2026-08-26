const CACHE_NAME = 'alola-v1';
const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/firebase-config.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});

// تسجيل الـ Service Worker لتفعيل التثبيت كأبلكيشن
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker Registered!'))
      .catch(err => console.log('Service Worker Failed:', err));
  });
}