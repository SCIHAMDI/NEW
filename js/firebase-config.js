/* =========================================================================
   إعدادات Firebase
   =========================================================================
   ضع بيانات مشروعك هنا. تقدر تجيبها من:
   Firebase Console → Project settings → General → Your apps → SDK setup and configuration

   لازم يكون عندك في نفس المشروع:
   1) Authentication  → فعّل "Email/Password" (لدخول الأدمن فقط)
   2) Realtime Database → أنشئ قاعدة بيانات وحط الـ Rules الموجودة في ملف
      README.md المرفق مع المشروع
   ========================================================================= */
// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDq-NRN8YcdXKHGyRoxklRyycWMxhtgiu4",
  authDomain: "al-ola-center.firebaseapp.com",
  databaseURL: "https://al-ola-center-default-rtdb.firebaseio.com",
  projectId: "al-ola-center",
  storageBucket: "al-ola-center.firebasestorage.app",
  messagingSenderId: "518596470658",
  appId: "1:518596470658:web:be6155f9d6dd6d531b519b",
  measurementId: "G-2CVDX07KME"
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();
const auth = firebase.auth();
/* Firebase Storage (لرفع صور إيصالات التحويل في الدفع الأونلاين)
   لازم تفعّل Storage من Firebase Console → Build → Storage → Get started
   لو مش عايز تستخدم Storage (حساب مجاني محدود)، الكود بيرجع تلقائياً لتخزين
   الصورة كـ Base64 جوه الـ Database - شغال برضو بس مش الأفضل لصور كبيرة. */
let storage = null;
try { storage = firebase.storage(); } catch (e) { console.warn("Firebase Storage غير مفعّل - هيتم استخدام Base64 بدلاً منه"); }

/* رابط الموقع الأساسي - يُستخدم في بناء رابط بروفايل الطالب و QR Code
   غيّره لرابط موقعك الحقيقي بعد الرفع (Hosting / أي سيرفر) */
const SITE_BASE_URL = window.location.origin + window.location.pathname.replace(/[^/]+$/, "");

/* =========================================================================
   بيانات الدفع الأونلاين المعروضة للطالب/ولي الأمر
   غيّرها لبيانات السنتر الحقيقية
   ========================================================================= */
const PAYMENT_INFO = {
  vodafoneCash: "01000000000",
  bankName: "بنك مصر",
  bankAccount: "0000000000000000",
  bankIban: "EG000000000000000000000000",
};
