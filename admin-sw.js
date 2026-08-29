/* ==========================================================
   Service Worker خاص بلوحة تحكم الأدمن (admin-sw.js)
   ==========================================================
   الهدف هنا بسيط ومحدود عن قصد: بيخزن "قشرة" التطبيق الثابتة (HTML/CSS/JS)
   عشان لوحة الأدمن تفتح بسرعة وتبقى قابلة للتثبيت كتطبيق على سطح المكتب.

   ⚠️ ده مش نظام "Offline-First" كامل: البيانات نفسها (الطلاب، الحضور،
   المصروفات...) لسه بتحتاج اتصال إنترنت شغال عشان تتقرا أو تتسجل، لأن ده
   محتاج قاعدة بيانات محلية حقيقية (IndexedDB/SQLite) ومزامنة، وده مشروع
   منفصل وأكبر بكتير من مجرد Service Worker. الملف ده بيخلي التطبيق "قابل
   للتثبيت" وأسرع في إعادة الفتح بس، مش شغال من غير نت خالص.
   ========================================================== */

const CACHE_NAME = "al-ola-admin-shell-v1";
const CORE_ASSETS = [
  "./admin.html",
  "./css/style.css",
  "./js/firebase-config.js",
  "./js/utils.js",
  "./js/face.js",
  "./js/data-export.js",
  "./js/admin.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch((e) => console.warn("admin-sw: تعذر تخزين بعض الملفات في الكاش", e))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // مهم جداً: أي طلب لـ Firebase (بيانات حية) بيتسيب يروح للنت مباشرة من غير
  // أي تدخل من الـ Service Worker - عشان مانعرضش بيانات قديمة على إنها محدّثة
  if (url.includes("firebaseio.com") || url.includes("googleapis.com") || url.includes("firebasedatabase.app")) {
    return;
  }

  // للملفات الثابتة بس: جرب الكاش الأول، ولو مش موجود روح جيبه من النت
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
