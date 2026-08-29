/* ==========================================================
   Al Ola Center - Unified PWA Service Worker
   يخزن واجهة التطبيق ومكتباته الثابتة، ويترك Firebase Database/Auth
   للاتصال المباشر مع طبقة Local-First الموجودة في offline-db.js.
   ========================================================== */
const CACHE_NAME = "al-ola-shell-v8";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./admin.html",
  "./student.html",
  "./manifest.json",
  "./admin-manifest.json",
  "./css/style.css",
  "./js/firebase-config.js",
  "./js/offline-db.js",
  "./js/utils.js",
  "./js/admin.js",
  "./js/student.js",
  "./js/data-export.js",
  "./js/face.js",
  "./images/icon-192.png",
  "./android/launchericon-192x192.png",
  "./android/launchericon-512x512.png",
  "./android/launchericon-512x512-maskable.png",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE_ASSETS.map(async (url) => {
      try { await cache.add(url); } catch (e) { console.warn("SW cache skip:", url, e); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isFirebaseRequest(url) {
  return /firebaseio\.com|firebasedatabase\.app|googleapis\.com\/identitytoolkit|googleapis\.com\/securetoken|firebasestorage\.googleapis\.com/.test(url);
}

function isStaticRequest(request) {
  const u = new URL(request.url);
  return request.method === "GET" && (
    u.origin === self.location.origin ||
    /gstatic\.com|cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net/.test(u.hostname)
  );
}

self.addEventListener("fetch", (event) => {
  if (isFirebaseRequest(event.request.url)) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const network = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, network.clone()).catch(() => {});
        return network;
      } catch (_) {
        return (await caches.match(event.request)) || (await caches.match("./index.html"));
      }
    })());
    return;
  }

  if (!isStaticRequest(event.request)) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) {
      fetch(event.request).then(r => {
        if (r && r.ok) caches.open(CACHE_NAME).then(c => c.put(event.request, r.clone()));
      }).catch(() => {});
      return cached;
    }
    try {
      const network = await fetch(event.request);
      if (network && network.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, network.clone()).catch(() => {});
      }
      return network;
    } catch (_) {
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
