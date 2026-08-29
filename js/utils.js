/* أدوات مشتركة بين كل الصفحات */

function showToast(message, type = "default") {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = "toast show " + (type === "error" ? "error" : type === "success" ? "success" : "");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

// توليد كود طالب فريد من 4 أرقام (يتأكد إنه مش مستخدم قبل كده)
async function generateUniqueStudentId() {
  let tries = 0;
  while (tries < 30) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const snap = await db.ref("students/" + code).get();
    if (!snap.exists()) return code;
    tries++;
  }
  // fallback: استخدام timestamp لو حصل تصادم كتير (نادر جداً)
  return String(Date.now()).slice(-4);
}

function formatDateArabic(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatTimeArabic(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthKeyArabic(date = new Date()) {
  const months = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  return months[date.getMonth()];
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ==========================================================
   تجميع المصروفات حسب المادة/المدرس (Billing Groups)
   ==========================================================
   لو الطالب مسجل في أكتر من مجموعة لنفس المدرس (مثلاً 3 مواعيد مختلفة عند "محمد نصار")،
   كل مجموعة دي بتتخزن كـ subject منفصل في student.subjects (subjectKey مختلف لكل واحدة)
   لكن للفوترة/المصروفات لازم تتحسب كمادة واحدة بس، مش تتكرر مع كل مجموعة.
   بنجمع حسب teacherId لو موجود (وده الحالة الغالبة)، أو حسب اسم المادة نفسه كـ fallback
   للمواد اللي اتضافت يدوي من غير ربط بمدرس معين.
   بيرجع array: [{ billingKey, name, fee, day, time, subjectKeys: [...] }]
   ========================================================== */
/* الاسم "الأساسي" للمادة - الجزء اللي قبل أول " - " في الاسم (لو موجود)
   بيستخدم كـ fallback للتجميع لما مفيش teacherId موثوق فيه (مثلاً مادة اتضافت يدوي
   بالاسم "كيمياء محمد نصار - 3:00ص" و"كيمياء محمد نصار - 4:00ص" - نفس المدرس فعلياً
   بس من غير ربط برمجي بمعرّف المدرس) */
function billingBaseName(name) {
  if (!name) return "";
  const idx = name.indexOf(" - ");
  return idx > -1 ? name.slice(0, idx).trim() : name.trim();
}

function getBillingGroups(subjectsObj) {
  const entries = Object.entries(subjectsObj || {});
  const groups = {};
  entries.forEach(([key, s]) => {
    const baseName = billingBaseName(s.name);
    // إصلاح: نجمع بالأولوية حسب teacherId لو موجود (الأدق)، وإلا حسب "الاسم الأساسي"
    // للمادة - ده بيغطي حالة إضافة نفس المادة يدوياً أكتر من مرة بأسماء متشابهة بس
    // بمواعيد مختلفة، من غير ما تكون مربوطة برمجياً بنفس معرّف المدرس (teacherId)
    const billingKey = s.teacherId ? "t:" + s.teacherId : "n:" + baseName;
    if (!groups[billingKey]) {
      groups[billingKey] = { billingKey, name: baseName || s.name, fee: s.fee, day: s.day, time: s.time, subjectKeys: [] };
    }
    groups[billingKey].subjectKeys.push(key);
    // لو فيه فرق بسيط في المصاريف بين المجموعات (نادر لكن احتياطاً)، بناخد أعلى قيمة تجنباً لنقص التحصيل
    const feeNum = parseFloat(s.fee) || 0;
    const curFeeNum = parseFloat(groups[billingKey].fee) || 0;
    if (feeNum > curFeeNum) groups[billingKey].fee = s.fee;
  });
  return Object.values(groups);
}

/* هل مادة/مدرس معين (billing group) مدفوعة لشهر معين؟ - بنعتبرها مدفوعة لو أي مجموعة منها
   اتسجلت كمدفوعة (احتياطاً للتوافق مع بيانات قديمة كانت بتتسجل مجموعة بمجموعة قبل هذا التحديث) */
function isBillingGroupPaid(group, monthPayments) {
  return group.subjectKeys.some((k) => !!(monthPayments || {})[k]);
}

/* ==========================================================
   دورة الاشتراك 30 يوم (Subscription Cycle) - بديل عادل لتصفير الحساب مع بداية
   كل شهر ميلادي: لو الطالب دفع يوم 1، الاشتراك بيفضل ساري لحد يوم 31 بالظبط (30
   يوم كاملة)، ولو دفع يوم 15 بيفضل ساري لحد يوم 15 من الشهر اللي بعده - بالظبط
   30 يوم من تاريخ الدفع الفعلي، مش من أول الشهر. بيتخزن في:
   students/{code}/subscriptionDates/{billingKey} = "2026-08-15T10:00:00.000Z"
   ========================================================== */
const SUBSCRIPTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/* بيرجع عدد الأيام المتبقية لحد ما يجي معاد الدفع الجاي:
   - null: لسه الطالب مدفعش الاشتراك ده أبداً
   - رقم موجب: باقي كام يوم للموعد الجاي (وبينقص كل يوم تلقائياً لأنه بيتحسب حي من التاريخ الحالي)
   - صفر أو سالب: الاشتراك خلص/متأخر بعدد الأيام دي بالظبط */
function getSubscriptionDaysRemaining(lastPaidISO) {
  if (!lastPaidISO) return null;
  const paidAt = new Date(lastPaidISO).getTime();
  if (isNaN(paidAt)) return null;
  const dueAt = paidAt + SUBSCRIPTION_DAYS * DAY_MS;
  return Math.ceil((dueAt - Date.now()) / DAY_MS);
}

/* نص جاهز للعرض + حالة (active/due/never) لاستخدامه في أي واجهة */
function formatSubscriptionStatus(lastPaidISO) {
  const days = getSubscriptionDaysRemaining(lastPaidISO);
  if (days === null) return { text: "لسه مدفعش الاشتراك ده أبداً", state: "never", days: null };
  if (days > 0) return { text: `الاشتراك ساري - باقي ${days} يوم للموعد الجاي`, state: "active", days };
  if (days === 0) return { text: "الاشتراك بيخلص النهاردة بالظبط", state: "due", days };
  return { text: `الاشتراك انتهى من ${Math.abs(days)} يوم - محتاج تجديد`, state: "overdue", days };
}

/* ---------- شهر الدفع الحالي بصيغة 2026-08 ---------- */
function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-");
  const months = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  return `${months[Number(m) - 1]} ${y}`;
}

/* ---------- رابط واتساب مباشر برسالة جاهزة ----------
   ملحوظة مهمة: من متصفح عادي (بدون سيرفر / WhatsApp Business API مدفوع)
   مينفعش نبعت رسالة واتساب تلقائي 100% من غير تدخل بشري.
   الطريقة العملية المتاحة: نفتح واتساب للأدمن ومعبّى فيه رقم ولي الأمر
   والرسالة جاهزة، وهو بس يضغط "إرسال". ده أقصى حاجة ممكنة client-side. */
/* ==========================================================
   إعدادات إرسال الواتساب (settings/systemConfig):
   - disableAutoPopup: لو true، النظام ما يفتحش نافذة واتساب تلقائياً خالص عند تسجيل
     الحضور/الانصراف (يفضل بس الزرار اليدوي بدون أي فتح مفاجئ لتطبيق واتساب)
   - webhookUrl: رابط API خارجي (مثلاً Make.com / Zapier / سيرفر Twilio خاص بيك) - لو
     متسجل، النظام هيبعتله طلب POST فيه رقم الهاتف والرسالة في الخلفية بدون فتح أي نافذة
     خالص، وهو اللي هيتكفل بإرسال الواتساب فعلياً بشكل آلي 100% من غير أي تدخل بشري -
     ده البديل الحقيقي الوحيد للأتمتة الكاملة (المتصفح وحده مينفعش يبعت واتساب بدون تدخل).
   ========================================================== */
let WA_CONFIG = { disableAutoPopup: false, webhookUrl: "", notifySound: "" };

async function loadWaConfig() {
  try {
    const snap = await db.ref("settings/systemConfig").get();
    if (snap.exists()) WA_CONFIG = Object.assign(WA_CONFIG, snap.val());
  } catch (e) { /* تجاهل - هيفضل شغال بالإعدادات الافتراضية */ }
  // استماع دائم لأي تحديث للإعدادات دي (لو الأدمن غيّرها من تبويب الإعدادات في تبويب/جهاز تاني)
  db.ref("settings/systemConfig").on("value", (snap) => {
    if (snap.exists()) WA_CONFIG = Object.assign({ disableAutoPopup: false, webhookUrl: "", notifySound: "" }, snap.val());
  });
}

/* ==========================================================
   صوت تنبيه عند نجاح العمليات (حضور/انصراف، تأكيد دفع، إنشاء حساب طالب)
   لو الأدمن رفع صوت مخصص من الإعدادات بيتشغل هو، ولو لأ بيتشغل صوت "بيب" افتراضي بسيط
   عن طريق Web Audio API من غير ما نحتاج أي ملف صوت خارجي.
   ========================================================== */
function playNotifySound() {
  try {
    if (WA_CONFIG.notifySound) {
      const audio = new Audio(WA_CONFIG.notifySound);
      audio.play().catch(() => {});
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.start();
    o.stop(ctx.currentTime + 0.35);
  } catch (e) { /* تجاهل لو المتصفح مانع تشغيل صوت بدون تفاعل مستخدم */ }
}

function buildWhatsAppLink(phone, message) {
  if (!phone) return null;
  let clean = String(phone).replace(/[^\d+]/g, "");
  if (clean.startsWith("0")) clean = "2" + clean; // مصر: تحويل 01xxxxxxxxx إلى 201xxxxxxxxx
  if (clean.startsWith("+")) clean = clean.slice(1);
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

function sendWhatsApp(phone, message) {
  const link = buildWhatsAppLink(phone, message);
  if (!link) {
    showToast("لا يوجد رقم ولي أمر مسجل لهذا الطالب", "error");
    return null;
  }
  return window.open(link, "_blank");
}

/* إرسال عبر الـ webhook الخارجي (لو متسجل) - Fire-and-forget، بيرجع Promise<boolean> بنجاح الإرسال */
async function sendViaWebhook(phone, message) {
  if (!WA_CONFIG.webhookUrl) return false;
  try {
    await fetch(WA_CONFIG.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, message, sentAt: Date.now(), source: "Al Ola Center" }),
    });
    return true;
  } catch (e) {
    console.error("فشل الإرسال عبر الـ webhook:", e);
    return false;
  }
}

/* ==========================================================
   عنصر واتساب "تلقائي + يدوي مع حالة واضحة":
   - لو فيه webhook مُفعّل من الإعدادات: بيبعت في الخلفية بدون فتح أي نافذة خالص (أتمتة حقيقية).
   - لو مفيش webhook والفتح التلقائي مسموح: بيحاول يفتح واتساب تلقائياً فور ظهوره.
   - لو "منع الفتح التلقائي" مفعّل من الإعدادات: هيفضل بس الزرار اليدوي بدون أي فتح مفاجئ.
   - في كل الأحوال فيه زرار "إرسال" يدوي جاهز، وجنبه حالة واضحة "تم الإرسال" أو "لسه".
   ========================================================== */
function renderWhatsAppControl(phone, message) {
  const wrap = document.createElement("span");
  wrap.className = "wa-control";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-teal";

  const status = document.createElement("span");
  status.className = "wa-status";

  if (!phone) {
    btn.textContent = "📱 إرسال واتساب";
    btn.disabled = true;
    status.textContent = "⚠️ لا يوجد رقم ولي أمر مسجل";
    wrap.appendChild(btn);
    wrap.appendChild(status);
    return wrap;
  }

  function markSent(mode) {
    // mode: "webhook" | "auto" | "manual"
    const text = { webhook: "✅ تم الإرسال آلياً عبر الـ API (بدون فتح أي نافذة)", auto: "✅ تم إرسال الرسالة لولي الأمر تلقائياً", manual: "✅ تم إرسال الرسالة لولي الأمر" }[mode];
    status.textContent = text;
    status.classList.add("sent");
    btn.textContent = "🔁 إعادة الإرسال";
  }

  btn.textContent = "📱 إرسال واتساب";
  btn.addEventListener("click", () => {
    sendWhatsApp(phone, message);
    markSent("manual");
  });

  wrap.appendChild(btn);
  wrap.appendChild(status);

  if (WA_CONFIG.webhookUrl) {
    // أتمتة حقيقية بدون أي نافذة - بيتبعت في الخلفية عبر الـ API الخارجي المسجل
    status.textContent = "⏳ جاري الإرسال آلياً عبر الـ API...";
    sendViaWebhook(phone, message).then((ok) => {
      if (ok) markSent("webhook");
      else status.textContent = "⚠️ فشل الإرسال عبر الـ API - جرّب الزرار اليدوي";
    });
  } else if (!WA_CONFIG.disableAutoPopup) {
    // محاولة إرسال تلقائي فوري بفتح نافذة واتساب (بيشتغل حسب سياسة المتصفح)
    const w = sendWhatsApp(phone, message);
    if (w && !w.closed) markSent("auto");
    else status.textContent = "⏳ لم يتم الإرسال بعد - اضغط الزرار";
  } else {
    // الأدمن فعّل "منع فتح واتساب تلقائياً" من الإعدادات
    status.textContent = "⏳ لم يتم الإرسال - اضغط الزرار يدوياً (تم إيقاف الفتح التلقائي من الإعدادات)";
  }

  return wrap;
}

/* ---------- تحويل الوقت الحالي لدقائق منذ منتصف الليل ---------- */
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/* هل الوقت الحالي جوه معاد أحد مواعيد مادة معينة (بسماحية دقايق قبل/بعد)؟ - بيتحقق من الوقت بس */
function isWithinSchedule(times, graceMinutes = 20) {
  if (!times || !times.length) return true; // لو مفيش مواعيد محددة، منمنعش الحضور
  const now = nowMinutes();
  return times.some((t) => {
    const tm = timeToMinutes(t);
    if (tm === null) return false;
    return Math.abs(now - tm) <= graceMinutes;
  });
}

/* ==========================================================
   التحقق الذكي من اليوم + الوقت معاً (Smart Scheduling)
   ========================================================== */
const DAY_NAMES_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]; // نفس ترتيب JS Date.getDay() (الأحد = 0)

function todayDayNameAr() {
  return DAY_NAMES_AR[new Date().getDay()];
}

function parseDaysCsv(csv) {
  return String(csv || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/* عنصر checkboxes للأيام - بيتستخدم في نموذج إضافة مجموعة المدرس ونموذج المادة اليدوي */
function dayCheckboxesHtml(selectedCsv) {
  const selected = parseDaysCsv(selectedCsv);
  return `<div class="day-checkboxes" data-day-group>` +
    DAY_NAMES_AR.map((d) => `<label class="day-chip"><input type="checkbox" value="${d}" ${selected.includes(d) ? "checked" : ""}>${d}</label>`).join("") +
    `</div>`;
}

function getCheckedDaysCsv(scopeEl) {
  return [...scopeEl.querySelectorAll('[data-day-group] input[type="checkbox"]:checked')].map((cb) => cb.value).join(",");
}

function setCheckedDays(scopeEl, csv) {
  const selected = parseDaysCsv(csv);
  scopeEl.querySelectorAll('[data-day-group] input[type="checkbox"]').forEach((cb) => { cb.checked = selected.includes(cb.value); });
}

/* التحقق الذكي: هل النهاردة فعلاً يوم من أيام أي مادة من مواد الطالب، وفي نفس الوقت داخل هامش المعاد؟
   مثال: لو معاد المجموعة "السبت، الأحد" الساعة 2:00، وجه الطالب يوم الإثنين الساعة 2:00 - النظام هيرفض
   لأن الإثنين مش من أيام المجموعة، حتى لو الوقت مطابق تماماً.
   ملحوظة توافق: لو بيانات الأيام قديمة (نص حر زي "حد - تلات" مش متطابق مع أسماء الأيام القياسية)،
   بيتم تجاهل شرط اليوم تلقائياً والاكتفاء بالتحقق من الوقت بس، عشان مايتأثرش الطلاب القدامى. */
function isScheduledNow(subjects, graceMinutes = 20) {
  if (!subjects || !subjects.length) return true;
  const todayName = todayDayNameAr();
  const now = nowMinutes();
  return subjects.some((s) => {
    const days = parseDaysCsv(s.day);
    const recognizedDays = days.filter((d) => DAY_NAMES_AR.includes(d));
    if (recognizedDays.length && !recognizedDays.includes(todayName)) return false; // فيه أيام محددة بوضوح والنهاردة مش منهم
    const tm = timeToMinutes(s.time);
    if (tm === null) return true; // مفيش وقت محدد لهذه المادة، منمنعش الحضور بسببها
    return Math.abs(now - tm) <= graceMinutes;
  });
}

/* ---------- عداد "متصل الآن" باستخدام Firebase Presence ---------- */
function trackPresence(pageName) {
  try {
    const connectedRef = db.ref(".info/connected");
    connectedRef.on("value", (snap) => {
      if (snap.val() === true) {
        const myRef = db.ref("presence/" + Date.now() + "_" + Math.random().toString(36).slice(2));
        myRef.set({ page: pageName, at: Date.now() });
        myRef.onDisconnect().remove();
      }
    });
  } catch (e) { /* تجاهل لو مفيش صلاحية */ }
}

/* عداد "عدد مرات الفتح" - تزويد رقم بسيط لكل تحميل صفحة (الإجمالي - بدون تعديل) */
function trackPageView() {
  try {
    db.ref("stats/pageViews").transaction((v) => (v || 0) + 1);
  } catch (e) {}
  // إضافة: سجل زمني لآخر 24 ساعة + تتبع الزيارات المباشرة (رابط مباشر بدون referrer)
  try {
    const isDirect = !document.referrer || document.referrer.indexOf(window.location.hostname) === -1;
    db.ref("stats/pageViewsLog").push({ at: Date.now(), direct: isDirect });
    if (isDirect) db.ref("stats/directTraffic").transaction((v) => (v || 0) + 1);
  } catch (e) {}
}

/* عدد مرات فتح الموقع خلال آخر 24 ساعة - بيرجع Promise<number>
   إصلاح: بدل الاعتماد على orderByChild("at") اللي محتاجة .indexOn معرّف صح في Database Rules
   (وأي نقص فيها كان ممكن يسبب رجوع صفر دايماً بصمت)، بنجيب السجل كله ونفلتره في المتصفح - أضمن. */
async function getViewsLast24h() {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const snap = await db.ref("stats/pageViewsLog").get();
    if (!snap.exists()) return 0;
    return Object.values(snap.val()).filter((v) => v && v.at >= cutoff).length;
  } catch (e) { console.error("فشل حساب عدد الزيارات آخر 24 ساعة:", e); return 0; }
}

/* تنظيف السجل الزمني من أي إدخالات أقدم من 48 ساعة (تنظيف اختياري لتخفيف حجم قاعدة البيانات) */
async function cleanupOldViewLogs() {
  try {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const snap = await db.ref("stats/pageViewsLog").get();
    if (!snap.exists()) return;
    const updates = {};
    Object.entries(snap.val()).forEach(([k, v]) => { if (v && v.at < cutoff) updates[k] = null; });
    if (Object.keys(updates).length) await db.ref("stats/pageViewsLog").update(updates);
  } catch (e) {}
}

/* ==========================================================
   إعدادات وتخصيص المظهر (ثيم / لوجو / خلفية / ألوان) - مشتركة
   settings/admin  و settings/student في قاعدة البيانات
   ========================================================== */
function applySavedTheme(scope /* "admin" | "student" */, settings) {
  if (!settings) return;
  const root = document.documentElement;
  if (settings.topBarColor) root.style.setProperty("--topbar-color", settings.topBarColor);
  if (settings.mode === "dark") document.body.classList.add("dark-mode");
  else document.body.classList.remove("dark-mode");

  // شفافية/وضوح الخلفية - القيمة اللي بيضبطها الأدمن من الإعدادات (0 = خلفية واضحة، 100 = شبه مخفية)
  const opacityPercent = settings.bgOpacity != null ? settings.bgOpacity : 85;
  root.style.setProperty("--bg-overlay-alpha", (opacityPercent / 100).toFixed(2));

  if (settings.logo) {
    document.querySelectorAll(".theme-logo-slot").forEach((elm) => {
      elm.style.backgroundImage = `url(${settings.logo})`;
      elm.classList.add("has-logo");
    });
  }
  if (settings.background) {
    document.body.style.backgroundImage = `url(${settings.background})`;
    document.body.classList.add("has-bg-image");
  }
  // اللغة
  if (settings.lang === "en") {
    document.documentElement.setAttribute("lang", "en");
    document.documentElement.setAttribute("dir", "ltr");
    document.body.classList.add("lang-en");
  } else {
    document.documentElement.setAttribute("lang", "ar");
    document.documentElement.setAttribute("dir", "rtl");
    document.body.classList.remove("lang-en");
  }
}

async function loadAndApplyTheme(scope) {
  try {
    // كاش سريع محلي لتفادي وميض الشاشة قبل وصول بيانات Firebase
    const cached = localStorage.getItem("theme_" + scope);
    if (cached) applySavedTheme(scope, JSON.parse(cached));

    const snap = await db.ref("settings/" + scope).get();
    if (snap.exists()) {
      const settings = snap.val();
      applySavedTheme(scope, settings);
      localStorage.setItem("theme_" + scope, JSON.stringify(settings));
    }
  } catch (e) { /* تجاهل - الثيم الافتراضي هيفضل شغال */ }
}

/* تحويل صورة مرفوعة إلى Base64 (بديل بسيط لو مش عايز تستخدم Firebase Storage) */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ضغط صورة Base64 وتصغيرها قبل تخزينها في قاعدة البيانات (مستخدمة في الثيمات وإثباتات الدفع) */
function compressBase64(base64Str, maxWidth = 600, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width, height = img.height;
      if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = base64Str;
  });
}
