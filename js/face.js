/* ==========================================================
   بصمة الوجه (Face Recognition) - js/face.js
   ==========================================================
   بيستخدم مكتبة face-api.js (بتشتغل بالكامل جوه المتصفح - TensorFlow.js)
   مفيش أي صورة أو فيديو بيترفع لأي سيرفر خارجي؛ اللي بيتخزن في قاعدة
   البيانات هو فقط "الوصف الرقمي" للوجه (face descriptor - مصفوفة من 128 رقم)
   ومينفعش ترجعه لصورة تاني، فهو مشابه من ناحية الخصوصية لأي بصمة تانية.

   لازم تضيف السكريبت ده قبل js/face.js في أي صفحة هتستخدمه:
   <script src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js"></script>
   ========================================================== */

const FACE_MODELS_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";
const FACE_MATCH_THRESHOLD = 0.45; // كل ما قل الرقم كل ما كانت المطابقة أدق وأصعب (بتقلل نسبة الخطأ في التعرف على طالب غلط)

let faceModelsLoaded = false;
let faceModelsLoading = null;

/* تحميل نماذج التعرف على الوجه (مرة واحدة بس طول عمر الصفحة) */
async function loadFaceModels() {
  if (faceModelsLoaded) return true;
  if (faceModelsLoading) return faceModelsLoading;
  if (typeof faceapi === "undefined") {
    console.warn("مكتبة face-api.js مش متحمّلة - تأكد من إضافة السكريبت في الصفحة");
    return false;
  }
  faceModelsLoading = (async () => {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODELS_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_URL),
      ]);
      faceModelsLoaded = true;
      return true;
    } catch (e) {
      console.error("فشل تحميل نماذج بصمة الوجه:", e);
      return false;
    } finally {
      faceModelsLoading = null;
    }
  })();
  return faceModelsLoading;
}

/* تشغيل كاميرا الوجه على عنصر <video> معين، وبيرجع الـ stream عشان تقدر توقفه بعدين */
async function startFaceCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

function stopFaceCamera(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

/* بيحاول يلاقي وجه واحد واضح في الفيديو ويرجع الوصف الرقمي بتاعه (128 رقم) أو null لو مفيش وجه واضح
   إعدادات الكشف مضبوطة على توازن بين الدقة والسرعة - inputSize أكبر = دقة أعلى بس أبطأ شوية */
const FACE_DETECTOR_OPTIONS = { inputSize: 416, scoreThreshold: 0.5 };

async function detectFaceDescriptor(videoEl) {
  if (!faceModelsLoaded) return null;
  try {
    const result = await faceapi
      .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions(FACE_DETECTOR_OPTIONS))
      .withFaceLandmarks()
      .withFaceDescriptor();
    return result ? Array.from(result.descriptor) : null;
  } catch (e) {
    console.error("خطأ أثناء تحليل الوجه:", e);
    return null;
  }
}

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/* إيجاد أقرب طالب لبصمة وجه معينة من بين كل الطلاب اللي مسجلين بصمة وجههم */
function findBestFaceMatch(descriptor, studentsCache, threshold = FACE_MATCH_THRESHOLD) {
  let bestCode = null;
  let bestDist = Infinity;
  Object.entries(studentsCache || {}).forEach(([code, s]) => {
    if (!s || !s.faceDescriptor || !s.faceDescriptor.length) return;
    const dist = euclideanDistance(descriptor, s.faceDescriptor);
    if (dist < bestDist) {
      bestDist = dist;
      bestCode = code;
    }
  });
  if (bestCode !== null && bestDist <= threshold) {
    return { code: bestCode, distance: bestDist };
  }
  return null;
}
