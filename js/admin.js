/* ==========================================================
   لوحة تحكم الأدمن - المنطق الكامل
   ========================================================== */

const GRACE_MINUTES = 20; // هامش السماح بالدقايق حوالين معاد الحصة عشان يقدر يسجل حضور
const LATE_MINUTES = 15; // بعد اد ايه من المعاد يعتبر "فايت معادو"

// ---------- حماية الصفحة: لازم تسجيل دخول ----------
auth.onAuthStateChanged((user) => {
  if (!user) window.location.href = "index.html";
  else init();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  auth.signOut().then(() => (window.location.href = "index.html"));
});

// ---------- التابات ----------
const tabs = document.querySelectorAll(".tab-item");
const panels = document.querySelectorAll(".tab-panel");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    panels.forEach((p) => p.classList.add("hidden"));
    document.getElementById("tab-" + tab.dataset.tab).classList.remove("hidden");
    if (tab.dataset.tab === "attendance") refreshMissedList();
    if (tab.dataset.tab === "overview") loadOverview();
    if (tab.dataset.tab === "groups") loadGroupsOverview();
    if (tab.dataset.tab === "absentees") refreshAbsenteesList();
    if (tab.dataset.tab === "support") loadSupportInbox();
    if (tab.dataset.tab === "settings") { loadSettingsPanel(); loadFinanceLedger(); loadSavedBackupsList(); }
  });
});

function goToTab(name) {
  document.querySelector(`.tab-item[data-tab="${name}"]`).click();
}

function updateTabBadge(tabName, count) {
  const tabBtn = document.querySelector(`.tab-item[data-tab="${tabName}"]`);
  if (!tabBtn) return;
  let badge = tabBtn.querySelector(".tab-badge");
  if (!count) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "tab-badge";
    tabBtn.appendChild(badge);
  }
  badge.textContent = count > 99 ? "99+" : count;
}

let badgeListenersAttached = false;
function attachBadgeListeners() {
  if (badgeListenersAttached) return;
  badgeListenersAttached = true;

  // شارة "المصروفات": بيتحدث من نفس الاشتراك المباشر جوه loadPaymentRequests() -
  // بدل اشتراك منفصل تاني بيعيد تحميل نفس بيانات طلبات الدفع من الصفر (تحسين أداء)

  // شارة "الغائبين": بيتحدث من نفس الاشتراك المباشر في absenteesListenerRef (attachAbsenteesListener)
  // اللي بيتنقل تلقائياً لمسار اليوم الجديد كل 24 ساعة - شوف renderAbsenteesList()

  // شارة "الشكاوى والاستفسارات": عدد المحادثات اللي آخر رسالة فيها من الطالب (لسه محتاجة رد)
  db.ref("supportChats").on("value", (snap) => {
    const all = snap.exists() ? snap.val() : {};
    let open = 0;
    Object.values(all).forEach((c) => {
      const msgs = Object.values(c.messages || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
      const last = msgs[msgs.length - 1];
      if (last && last.from === "student") open++;
    });
    updateTabBadge("support", open);
  });
}

async function init() {
  trackPresence("admin");
  await loadAndApplyTheme("admin");
  await loadWaConfig();
  await loadOverview(); // بيحمّل studentsCache عشان أعداد الطلاب في كل مجموعة تظهر صح من أول مرة
  await loadTeachersCache();
  addSubjectRow(subjectsWrap);
  loadTodayAttendance();
  refreshMissedList();
  loadPaymentRequests();
  cleanupOldViewLogs();
  startAutoAbsenceChecker();
  cleanupOldSupportChats();
  attachBadgeListeners();
}

/* ==========================================================
   المدرسين والمجموعات (Teachers cache + CRUD)
   ========================================================== */
let teachersCache = {}; // { teacherId: {name, groups:{groupId:{label,day,time,fee}}} }
let teachersFirstLoadResolved = false;
let resolveTeachersFirstLoad;
const teachersFirstLoadPromise = new Promise((resolve) => (resolveTeachersFirstLoad = resolve));

// إصلاح جذري لمشكلة "المدرسين ما بيظهروش إلا بعد إضافة مدرس جديد":
// بدل ما نجيب المدرسين مرة واحدة بس عند فتح الصفحة، بنعمل استماع دائم (realtime listener)
// على مسار teachers من قاعدة البيانات - بيشتغل فوراً من لحظة تحميل الصفحة (قراءة teachers مسموحة
// للجميع في الـ Rules)، وأي تغيير في المدرسين (إضافة/حذف/تعديل مجموعة) بيتحدث في كل القوائم
// المعروضة على طول تلقائياً بدون ما تحتاج تعمل ريفريش أو تضيف مدرس جديد الأول.
db.ref("teachers").on("value", (snap) => {
  teachersCache = snap.exists() ? snap.val() : {};
  renderTeachersList();
  refreshAllTeacherSelects();
  if (!teachersFirstLoadResolved) {
    teachersFirstLoadResolved = true;
    resolveTeachersFirstLoad(teachersCache);
  }
});

// بيرجع Promise بالكاش الحالي - يضمن إن أي كود قديم بينادي عليها ويستنى النتيجة لسه شغال صح
function loadTeachersCache() {
  return teachersFirstLoadResolved ? Promise.resolve(teachersCache) : teachersFirstLoadPromise;
}

// إصلاح مشكلة "المدرسين ما بيظهروش إلا بعد إنشاء مدرس جديد":
// أي select مدرس معروض حالياً على الصفحة (سواء في تبويب إنشاء طالب أو تعديل بروفايل) بيتحدّث فوراً بمجرد ما الكاش يتغيّر
function refreshAllTeacherSelects() {
  document.querySelectorAll("[data-teacher-select]").forEach((sel) => {
    const prevValue = sel.value;
    sel.innerHTML = '<option value="">— بدون —</option>' + Object.entries(teachersCache).map(([id, t]) => `<option value="${id}" ${id === prevValue ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
  });
}

document.getElementById("teacherForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("t_name").value.trim();
  if (!name) return;
  await db.ref("teachers").push({ name, groups: {} });
  document.getElementById("t_name").value = "";
  showToast("تم إضافة المدرس", "success");
  // مفيش داعي نعمل تحميل يدوي - الـ realtime listener هيحدث القائمة تلقائياً
});

function renderTeachersList() {
  const wrap = document.getElementById("teachersList");
  const empty = document.getElementById("teachersEmpty");
  const entries = Object.entries(teachersCache);
  if (!entries.length) {
    wrap.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  wrap.innerHTML = "";

  entries.forEach(([teacherId, t]) => {
    const groups = t.groups || {};
    const counts = computeGroupCounts(teacherId);
    const totalStudents = Object.values(counts).reduce((a, b) => a + b, 0);
    const absentInfo = computeTeacherAbsences(teacherId);

    const card = el(`
      <div class="teacher-card">
        <div class="t-head">
          <div class="t-name">🧑‍🏫 ${escapeHtml(t.name)} <span style="color:var(--text-light); font-weight:600; font-size:12px;">(${totalStudents} طالب)</span>
            ${absentInfo.count > 0 ? `<span class="badge danger" style="margin-right:8px;" title="عدد الطلاب اللي ما حضروش آخر 3 حصص">🚫 ${absentInfo.count} غايب بعد 3 حصص</span>` : ""}
          </div>
          <button class="icon-btn" data-del-teacher>🗑️</button>
        </div>
        <div class="groups-pills"></div>
        <form class="add-group-form" style="margin-top:12px;">
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
            <input class="form-control" style="flex:1; min-width:120px;" placeholder="اسم المجموعة (مثال: مجموعة الساعة 3)" data-label required>
            <input type="time" class="form-control" style="width:110px;" data-time required>
            <input type="number" class="form-control" style="width:90px;" placeholder="المصاريف" data-fee required>
          </div>
          <label style="font-size:12px; font-weight:700; color:var(--text-mid); display:block; margin-bottom:2px;">أيام المجموعة (تقدر تختار أكتر من يوم)</label>
          ${dayCheckboxesHtml("")}
          <button type="submit" class="btn btn-outline">+ إضافة مجموعة</button>
        </form>
      </div>`);

    const pillsWrap = card.querySelector(".groups-pills");
    Object.entries(groups).forEach(([groupId, g]) => {
      const pill = el(`<span class="group-pill">${escapeHtml(g.label)} - ${escapeHtml(parseDaysCsv(g.day).join("، "))} - ${escapeHtml(g.time)} <span class="count">${counts[groupId] || 0}</span> <b data-del-group="${groupId}" style="cursor:pointer; color:var(--pink);">✕</b></span>`);
      pill.querySelector("[data-del-group]").addEventListener("click", async () => {
        if (!confirm("حذف هذه المجموعة؟")) return;
        await db.ref(`teachers/${teacherId}/groups/${groupId}`).remove();
        await loadTeachersCache();
      });
      pillsWrap.appendChild(pill);
    });

    card.querySelector("[data-del-teacher]").addEventListener("click", async () => {
      if (!confirm("حذف هذا المدرس وكل مجموعاته؟")) return;
      await db.ref("teachers/" + teacherId).remove();
      await loadTeachersCache();
    });

    card.querySelector(".add-group-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const label = f.querySelector("[data-label]").value.trim();
      const day = getCheckedDaysCsv(f);
      const time = f.querySelector("[data-time]").value;
      const fee = f.querySelector("[data-fee]").value;
      if (!day) { showToast("اختار يوم واحد على الأقل للمجموعة", "error"); return; }
      await db.ref(`teachers/${teacherId}/groups`).push({ label, day, time, fee });
      showToast("تم إضافة المجموعة", "success");
      await loadTeachersCache();
    });

    wrap.appendChild(card);
  });
}

// عدد الطلاب المسجلين في كل مجموعة لمدرس معين (بيدور جوه بيانات كل الطلاب)
let studentsCache = {};
function computeGroupCounts(teacherId) {
  const counts = {};
  Object.values(studentsCache).forEach((s) => {
    Object.values(s.subjects || {}).forEach((sub) => {
      if (sub.teacherId === teacherId && sub.groupId) {
        counts[sub.groupId] = (counts[sub.groupId] || 0) + 1;
      }
    });
  });
  return counts;
}

/* حساب عدد الطلاب اللي ماحضروش لمدرس معين بعد مرور آخر 3 حصص خاصة بيه
   المنطق: لكل مجموعة تابعة للمدرس، بنجيب آخر 3 تواريخ فعلياً حصل فيها حضور (سجلات attendance)
   لمواد مرتبطة بنفس المجموعة، وبعدين بنشوف كل طالب مسجل في المجموعة دي حضر كام حصة من التلاتة دول.
   لو الطالب معندوش أي حضور في التلاتة حصص دول (وكانت متاحة له فعلاً) بيتحسب "غايب بعد 3 حصص". */
function computeTeacherAbsences(teacherId) {
  const t = teachersCache[teacherId];
  if (!t || !t.groups) return { count: 0, students: [] };
  let absentStudents = [];

  Object.keys(t.groups).forEach((groupId) => {
    // كل الطلاب المسجلين في هذه المجموعة
    const enrolled = Object.entries(studentsCache).filter(([, s]) =>
      Object.values(s.subjects || {}).some((sub) => sub.teacherId === teacherId && sub.groupId === groupId)
    );
    if (!enrolled.length) return;

    // كل تواريخ الحضور المسجلة فعلياً لأي طالب من طلاب هذه المجموعة (type=in)
    const allDates = new Set();
    enrolled.forEach(([, s]) => {
      Object.values(s.attendance || {}).forEach((a) => { if (a.type === "in" && a.date) allDates.add(a.date); });
    });
    const last3Dates = [...allDates].sort().slice(-3);
    if (last3Dates.length < 3) return; // لسه المجموعة معملتش 3 حصص كفاية للحكم

    enrolled.forEach(([code, s]) => {
      const studentDates = new Set(Object.values(s.attendance || {}).filter((a) => a.type === "in").map((a) => a.date));
      const attendedInLast3 = last3Dates.filter((d) => studentDates.has(d)).length;
      if (attendedInLast3 === 0) absentStudents.push({ code, name: s.name });
    });
  });

  return { count: absentStudents.length, students: absentStudents };
}

/* ==========================================================
   مكوّن صف "مادة / مجموعة" مع اختيار مدرس وتعبئة تلقائية
   ========================================================== */
function subjectRowTemplate(data = {}) {
  return `
    <div class="subject-row" data-row style="display:block;">
      <div class="row-2" style="margin-bottom:10px;">
        <div class="form-group" style="margin-bottom:0;">
          <label>اختر مدرس (للتعبئة التلقائية)</label>
          <select class="form-control" data-teacher-select></select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>اختر المجموعة</label>
          <select class="form-control" data-group-select disabled><option value="">اختر مدرس أولاً</option></select>
        </div>
      </div>
      <button type="button" class="btn btn-outline" data-add-all-groups style="margin-bottom:10px; display:none; font-size:12px; padding:8px 12px;">➕ سجّل الطالب في كل مجموعات هذا المدرس دفعة واحدة</button>
      <div class="row-2" style="margin-bottom:10px;">
        <div class="form-group" style="margin-bottom:0;">
          <label>اسم المادة / المجموعة</label>
          <input type="text" class="form-control" data-field="name" value="${escapeHtml(data.name || "")}" placeholder="مثال: رياضيات - مجموعة 3">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>الميعاد</label>
          <input type="time" class="form-control" data-field="time" value="${escapeHtml(data.time || "")}">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label>أيام هذه المادة (لازم تتطابق مع اليوم الفعلي وقت تسجيل الحضور)</label>
        ${dayCheckboxesHtml(data.day || "")}
      </div>
      <div class="row-2" style="margin-top:10px; align-items:end;">
        <div class="form-group" style="margin-bottom:0;">
          <label>المصاريف (ج)</label>
          <input type="number" class="form-control" data-field="fee" value="${escapeHtml(data.fee ?? "")}" placeholder="مثال: 300">
        </div>
        <button type="button" class="btn btn-danger" data-remove>حذف هذه المادة ✕</button>
      </div>
    </div>`;
}

function addSubjectRow(container, data = {}) {
  const row = el(subjectRowTemplate(data));
  row.dataset.teacherId = data.teacherId || "";
  row.dataset.groupId = data.groupId || "";

  const teacherSelect = row.querySelector("[data-teacher-select]");
  const groupSelect = row.querySelector("[data-group-select]");
  const addAllBtn = row.querySelector("[data-add-all-groups]");

  teacherSelect.innerHTML = '<option value="">— بدون —</option>' + Object.entries(teachersCache).map(([id, t]) => `<option value="${id}" ${id === data.teacherId ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");

  function fillGroups(teacherId, selectedGroupId) {
    const t = teachersCache[teacherId];
    if (!t || !t.groups || !Object.keys(t.groups).length) {
      groupSelect.innerHTML = '<option value="">لا توجد مجموعات</option>';
      groupSelect.disabled = true;
      addAllBtn.style.display = "none";
      return;
    }
    groupSelect.disabled = false;
    groupSelect.innerHTML = '<option value="">اختر مجموعة</option>' + Object.entries(t.groups).map(([gid, g]) => `<option value="${gid}" ${gid === selectedGroupId ? "selected" : ""}>${escapeHtml(g.label)} (${escapeHtml(parseDaysCsv(g.day).join("، "))} - ${escapeHtml(g.time)})</option>`).join("");
    // إظهار زرار "سجّله في كل المجموعات" لو المدرس عنده أكتر من مجموعة واحدة
    addAllBtn.style.display = Object.keys(t.groups).length > 1 ? "block" : "none";
  }

  if (data.teacherId) fillGroups(data.teacherId, data.groupId);

  teacherSelect.addEventListener("change", () => {
    row.dataset.teacherId = teacherSelect.value;
    row.dataset.groupId = "";
    fillGroups(teacherSelect.value, "");
  });

  groupSelect.addEventListener("change", () => {
    row.dataset.groupId = groupSelect.value;
    const t = teachersCache[teacherSelect.value];
    const g = t && t.groups ? t.groups[groupSelect.value] : null;
    if (g) {
      row.querySelector('[data-field="name"]').value = `${t.name} - ${g.label}`;
      row.querySelector('[data-field="time"]').value = g.time;
      row.querySelector('[data-field="fee"]').value = g.fee;
      setCheckedDays(row, g.day);
    }
  });

  // تمكين الطالب من التسجيل في كافة مجموعات المدرس دفعة واحدة (بدل ما يضيف كل مجموعة يدوياً)
  addAllBtn.addEventListener("click", () => {
    const teacherId = teacherSelect.value;
    const t = teachersCache[teacherId];
    if (!t || !t.groups || !Object.keys(t.groups).length) return;
    const groupEntries = Object.entries(t.groups);

    // إصلاح: بدل الاعتماد على محاكاة حدث "change" (اللي كان بيسجل مجموعة وحدة بس بشكل غير متوقع)،
    // بننشئ صف جديد مكتمل البيانات لكل مجموعة على حدة بشكل مباشر وصريح، وبعدين نشيل الصف الفارغ الأصلي
    groupEntries.forEach(([gid, g]) => {
      addSubjectRow(container, {
        teacherId,
        groupId: gid,
        name: `${t.name} - ${g.label}`,
        day: g.day,
        time: g.time,
        fee: g.fee,
      });
    });

    row.remove(); // إزالة الصف الفارغ اللي كان بس فيه اختيار المدرس بدون مجموعة محددة
    showToast(`تم تسجيل الطالب في ${groupEntries.length} مجموعة لهذا المدرس (${groupEntries.map(([, g]) => g.label).join("، ")})`, "success");
  });

  row.querySelector("[data-remove]").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function collectSubjects(container) {
  const subjects = {};
  container.querySelectorAll("[data-row]").forEach((row, i) => {
    const name = row.querySelector('[data-field="name"]').value.trim();
    const day = getCheckedDaysCsv(row);
    const time = row.querySelector('[data-field="time"]').value.trim();
    const fee = row.querySelector('[data-field="fee"]').value.trim();
    if (name) {
      subjects["s" + i + "_" + Date.now()] = {
        name, day, time, fee: fee || "0",
        teacherId: row.dataset.teacherId || "",
        groupId: row.dataset.groupId || "",
      };
    }
  });
  return subjects;
}

/* ==========================================================
   TAB: إنشاء حساب طالب جديد
   ========================================================== */
const subjectsWrap = document.getElementById("subjectsWrap");
document.getElementById("addSubjectBtn").addEventListener("click", () => addSubjectRow(subjectsWrap));

/* ---------- بصمة الوجه: إنشاء طالب جديد ---------- */
let c_faceStream = null;
let capturedFaceDescriptor = null;
let c_lastCreated = null; // آخر طالب اتعمله حساب - لزرار "عرض وطباعة كارت الطالب"

document.getElementById("c_startFaceCamBtn").addEventListener("click", async () => {
  const status = document.getElementById("c_faceStatus");
  status.className = ""; status.textContent = "⏳ جاري تحميل نظام التعرف على الوجه...";
  const ok = await loadFaceModels();
  if (!ok) { status.className = "face-status-err"; status.textContent = "⚠️ تعذر تحميل نظام بصمة الوجه (تأكد من الاتصال بالإنترنت)"; return; }
  try {
    c_faceStream = await startFaceCamera(document.getElementById("c_faceVideo"));
    document.getElementById("c_captureFaceBtn").disabled = false;
    status.className = ""; status.textContent = "الكاميرا شغالة - وجّه وجه الطالب للكاميرا واضغط التقاط";
  } catch (e) {
    status.className = "face-status-err"; status.textContent = "تعذر تشغيل الكاميرا: " + e.message;
  }
});

document.getElementById("c_captureFaceBtn").addEventListener("click", async () => {
  const status = document.getElementById("c_faceStatus");
  status.className = ""; status.textContent = "⏳ جاري التحليل...";
  const descriptor = await detectFaceDescriptor(document.getElementById("c_faceVideo"));
  if (!descriptor) { status.className = "face-status-err"; status.textContent = "🚫 مش شايف وش واضح قدام الكاميرا - قرّب وجه الطالب واتأكد من الإضاءة وحاول تاني"; return; }
  capturedFaceDescriptor = descriptor;
  status.className = "face-status-ok"; status.textContent = "✅ تم تسجيل بصمة الوجه بنجاح - هتتحفظ مع باقي بيانات الطالب";
  stopFaceCamera(c_faceStream);
  document.getElementById("c_captureFaceBtn").disabled = true;
});

function resetCreateFaceCapture() {
  stopFaceCamera(c_faceStream);
  c_faceStream = null;
  capturedFaceDescriptor = null;
  const status = document.getElementById("c_faceStatus");
  status.className = ""; status.textContent = "";
  document.getElementById("c_captureFaceBtn").disabled = true;
}

document.getElementById("createForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("createBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> جاري الإنشاء...';

  try {
    const name = document.getElementById("c_name").value.trim();
    const grade = document.getElementById("c_grade").value.trim();
    const parentPhone = document.getElementById("c_parentPhone").value.trim();
    const address = document.getElementById("c_address").value.trim();
    const studentNumber = document.getElementById("c_studentNumber").value.trim(); // اختياري
    const subjects = collectSubjects(subjectsWrap);

    const code = await generateUniqueStudentId();

    await db.ref("students/" + code).set({
      code, name, grade, parentPhone,
      studentNumber: studentNumber || "",
      address: address || "غير محدد",
      faceDescriptor: capturedFaceDescriptor || null, // بصمة الوجه (اختياري)
      subjects, grades: {}, attendance: {}, notes: {}, payments: {},
      createdAt: new Date().toISOString(),
    });

    const link = SITE_BASE_URL + "student.html?id=" + code;
    document.getElementById("resultCode").textContent = "كود الطالب: " + code;
    document.getElementById("resultLink").value = link;

    const qrBox = document.getElementById("resultQr");
    qrBox.innerHTML = "";
    new QRCode(qrBox, { text: link, width: 170, height: 170 });

    document.getElementById("createResult").classList.remove("hidden");
    c_lastCreated = { code, name, grade }; // لزرار "عرض وطباعة كارت الطالب"
    document.getElementById("createForm").reset();
    subjectsWrap.innerHTML = "";
    addSubjectRow(subjectsWrap);
    resetCreateFaceCapture();

    showToast("تم إنشاء حساب الطالب بنجاح", "success");
    playNotifySound();
    loadOverview();
  } catch (err) {
    console.error(err);
    showToast("حدث خطأ أثناء الإنشاء: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "إنشاء الحساب وتوليد الكود";
  }
});

/* ==========================================================
   TAB: الرئيسية (Overview)
   ========================================================== */
async function loadOverview() {
  const snap = await db.ref("students").get();
  studentsCache = snap.exists() ? snap.val() : {};
  const students = Object.entries(studentsCache);

  document.getElementById("ov_totalStudents").textContent = students.length;

  const today = todayKey();
  const presentToday = new Set();
  students.forEach(([code, s]) => {
    Object.values(s.attendance || {}).forEach((a) => {
      if (a.type === "in" && a.date === today) presentToday.add(code);
    });
  });
  document.getElementById("ov_todayPresent").textContent = presentToday.size;

  let paid = 0, unpaid = 0;
  students.forEach(([, s]) => {
    const res = isStudentPaidThisMonth(s);
    if (res.paid) paid++; else unpaid++;
  });
  document.getElementById("ov_paidCount").textContent = paid;
  document.getElementById("ov_unpaidCount").textContent = unpaid;

  const reqSnap = await db.ref("paymentRequests").get();
  const allReqs = reqSnap.exists() ? reqSnap.val() : {};
  document.getElementById("ov_requestsCount").textContent = Object.values(allReqs).filter((r) => r && r.status === "pending").length;

  // آخر 24 ساعة + الزيارات المباشرة
  getViewsLast24h().then((n) => (document.getElementById("ov_views24h").textContent = n));
  db.ref("stats/directTraffic").get().then((s) => (document.getElementById("ov_directTraffic").textContent = s.val() || 0));

  // غائبين اليوم
  db.ref("absentees/" + todayKey()).get().then((s) => {
    document.getElementById("ov_absentToday").textContent = s.exists() ? Object.keys(s.val()).length : 0;
  });

  // استفسارات لم يتم الرد عليها
  db.ref("supportChats").get().then((s) => {
    if (!s.exists()) { document.getElementById("ov_openTickets").textContent = 0; return; }
    const chats = s.val();
    let open = 0;
    Object.values(chats).forEach((c) => {
      const msgs = Object.values(c.messages || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
      const last = msgs[msgs.length - 1];
      if (last && last.from === "student") open++;
    });
    document.getElementById("ov_openTickets").textContent = open;
  });

  attachLiveOverviewListeners();
}

let liveListenersAttached = false;
function attachLiveOverviewListeners() {
  if (liveListenersAttached) return;
  liveListenersAttached = true;
  // متصلين الآن (presence) - listener مباشر - بيتحسب بس اللي فاتحين بوابة الطالب فعلاً (مش جلسة الأدمن نفسها)
  db.ref("presence").on("value", (s) => {
    if (!s.exists()) { document.getElementById("ov_online").textContent = 0; return; }
    const studentSessions = Object.values(s.val()).filter((p) => p && p.page === "student");
    document.getElementById("ov_online").textContent = studentSessions.length;
  });
  // عدد مرات الفتح
  db.ref("stats/pageViews").on("value", (s) => {
    document.getElementById("ov_pageViews").textContent = s.val() || 0;
  });
  // إجمالي المبالغ المحصّلة هذا الشهر - بيتحدث عن طريق attachFinanceRealtimeSync() (تحسين أداء:
  // listener واحد مشترك بدل ما كل شاشة تعمل اشتراك منفصل في نفس بيانات الطلاب/الطلبات)
  attachFinanceRealtimeSync();
}

function isStudentPaidThisMonth(student) {
  const billingGroups = getBillingGroups(student.subjects);
  if (!billingGroups.length) return { paid: true, unpaidSubjects: [] };
  const monthKey = currentMonthKey();
  const payments = (student.payments || {})[monthKey] || {};
  const unpaidSubjects = billingGroups.filter((g) => !isBillingGroupPaid(g, payments)).map((g) => ({ key: g.billingKey, name: g.name }));
  return { paid: unpaidSubjects.length === 0, unpaidSubjects };
}

// ----- Modal: كل الطلاب -----
document.getElementById("openAllStudentsBtn").addEventListener("click", async () => {
  const snap = await db.ref("students").get();
  studentsCache = snap.exists() ? snap.val() : {};
  renderAllStudentsList(studentsCache);
  document.getElementById("allStudentsModal").classList.remove("hidden");
});
document.getElementById("closeAllStudentsModal").addEventListener("click", () => {
  document.getElementById("allStudentsModal").classList.add("hidden");
});
document.getElementById("allStudentsSearch").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = Object.fromEntries(Object.entries(studentsCache).filter(([code, s]) => code.includes(q) || (s.name || "").toLowerCase().includes(q)));
  renderAllStudentsList(filtered);
});

function renderAllStudentsList(students) {
  const wrap = document.getElementById("allStudentsList");
  const entries = Object.entries(students);
  if (!entries.length) {
    wrap.innerHTML = '<p class="empty-box">لا يوجد طلاب</p>';
    return;
  }
  wrap.innerHTML = "";
  entries.forEach(([code, s]) => {
    const row = el(`<div class="student-list-row"><span class="name">${escapeHtml(s.name)}</span><span class="code">${escapeHtml(code)}</span></div>`);
    row.addEventListener("click", () => {
      document.getElementById("allStudentsModal").classList.add("hidden");
      goToTab("edit");
      document.getElementById("e_code").value = code;
      searchStudentForEdit();
    });
    wrap.appendChild(row);
  });
}

/* ==========================================================
   TAB: إضافة درجات الامتحانات (3 مربعات)
   ========================================================== */
let g_currentCode = null;

document.getElementById("g_searchBtn").addEventListener("click", searchStudentForGrades);
document.getElementById("g_code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchStudentForGrades(); } });

async function searchStudentForGrades() {
  const code = document.getElementById("g_code").value.trim();
  if (!code) return showToast("اكتب كود الطالب أولاً", "error");

  const snap = await db.ref("students/" + code).get();
  if (!snap.exists()) {
    showToast("لا يوجد طالب بهذا الكود", "error");
    document.getElementById("g_studentBox").style.display = "none";
    document.getElementById("gradeForm").classList.add("hidden");
    return;
  }
  const student = snap.val();
  g_currentCode = code;
  document.getElementById("g_studentName").textContent = `${student.name} - ${student.grade || ""}`;
  document.getElementById("g_studentBox").style.display = "flex";
  document.getElementById("gradeForm").classList.remove("hidden");
  renderGradesTable(student.grades || {});
}

document.getElementById("gradeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!g_currentCode) return;

  const examName = document.getElementById("g_examName").value.trim();
  const examDate = document.getElementById("g_examDate").value;
  const score = document.getElementById("g_score").value;
  const maxScore = document.getElementById("g_maxScore").value;

  try {
    await db.ref("students/" + g_currentCode + "/grades").push({
      examName, date: examDate, score: Number(score), maxScore: Number(maxScore), createdAt: new Date().toISOString(),
    });
    showToast("تم حفظ الدرجة بنجاح", "success");
    document.getElementById("gradeForm").reset();
    const snap = await db.ref("students/" + g_currentCode + "/grades").get();
    renderGradesTable(snap.val() || {});
  } catch (err) {
    showToast("حدث خطأ أثناء الحفظ: " + err.message, "error");
  }
});

function renderGradesTable(grades) {
  const tbody = document.querySelector("#g_gradesTable tbody");
  const emptyBox = document.getElementById("g_emptyGrades");
  tbody.innerHTML = "";
  const entries = Object.values(grades || {}).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!entries.length) {
    emptyBox.classList.remove("hidden");
    document.getElementById("g_gradesTable").classList.add("hidden");
    return;
  }
  emptyBox.classList.add("hidden");
  document.getElementById("g_gradesTable").classList.remove("hidden");
  entries.forEach((g) => {
    tbody.appendChild(el(`<tr><td>${escapeHtml(g.examName)}</td><td>${escapeHtml(g.date || "-")}</td><td>${g.score} / ${g.maxScore}</td></tr>`));
  });
}

/* ==========================================================
   TAB: تعديل بروفايل طالب
   ========================================================== */
let e_currentCode = null;
let e_currentStudent = null; // لزرار "عرض وطباعة كارت الطالب"
let e_faceStream = null;
let e_capturedFaceDescriptor = null;
const e_subjectsWrap = document.getElementById("e_subjectsWrap");
document.getElementById("e_addSubjectBtn").addEventListener("click", () => addSubjectRow(e_subjectsWrap));

document.getElementById("e_searchBtn").addEventListener("click", searchStudentForEdit);
document.getElementById("e_code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchStudentForEdit(); } });

document.getElementById("e_startFaceCamBtn").addEventListener("click", async () => {
  const status = document.getElementById("e_faceStatus");
  status.className = ""; status.textContent = "⏳ جاري تحميل نظام التعرف على الوجه...";
  const ok = await loadFaceModels();
  if (!ok) { status.className = "face-status-err"; status.textContent = "⚠️ تعذر تحميل نظام بصمة الوجه (تأكد من الاتصال بالإنترنت)"; return; }
  try {
    e_faceStream = await startFaceCamera(document.getElementById("e_faceVideo"));
    document.getElementById("e_captureFaceBtn").disabled = false;
    status.className = ""; status.textContent = "الكاميرا شغالة - وجّه وجه الطالب للكاميرا واضغط التقاط";
  } catch (err) {
    status.className = "face-status-err"; status.textContent = "تعذر تشغيل الكاميرا: " + err.message;
  }
});

document.getElementById("e_captureFaceBtn").addEventListener("click", async () => {
  const status = document.getElementById("e_faceStatus");
  status.className = ""; status.textContent = "⏳ جاري التحليل...";
  const descriptor = await detectFaceDescriptor(document.getElementById("e_faceVideo"));
  if (!descriptor) { status.className = "face-status-err"; status.textContent = "🚫 مش شايف وش واضح قدام الكاميرا - قرّب وجه الطالب واتأكد من الإضاءة وحاول تاني"; return; }
  e_capturedFaceDescriptor = descriptor;
  status.className = "face-status-ok"; status.textContent = "✅ تم التقاط بصمة وجه جديدة - هتتحفظ لما تضغط حفظ التعديلات";
  stopFaceCamera(e_faceStream);
  document.getElementById("e_captureFaceBtn").disabled = true;
});

async function searchStudentForEdit() {
  const code = document.getElementById("e_code").value.trim();
  if (!code) return showToast("اكتب كود الطالب أولاً", "error");

  const snap = await db.ref("students/" + code).get();
  if (!snap.exists()) {
    showToast("لا يوجد طالب بهذا الكود", "error");
    document.getElementById("editForm").classList.add("hidden");
    document.getElementById("e_codeQrBox").classList.add("hidden");
    return;
  }
  const student = snap.val();
  e_currentCode = code;
  e_currentStudent = student;

  document.getElementById("e_name").value = student.name || "";
  document.getElementById("e_grade").value = student.grade || "";
  document.getElementById("e_parentPhone").value = student.parentPhone || "";
  document.getElementById("e_address").value = student.address || "";
  document.getElementById("e_studentNumber").value = student.studentNumber || "";

  // إظهار الكود و QR فوراً زي شاشة إنشاء حساب جديد
  document.getElementById("e_codeDisplay").textContent = "كود الطالب: " + code;
  const eQrBox = document.getElementById("e_qrDisplay");
  eQrBox.innerHTML = "";
  new QRCode(eQrBox, { text: SITE_BASE_URL + "student.html?id=" + code, width: 150, height: 150 });
  document.getElementById("e_codeQrBox").classList.remove("hidden");

  // حالة بصمة الوجه الحالية
  e_capturedFaceDescriptor = null;
  stopFaceCamera(e_faceStream);
  document.getElementById("e_captureFaceBtn").disabled = true;
  document.getElementById("e_faceStatus").className = ""; document.getElementById("e_faceStatus").textContent = "";
  document.getElementById("e_faceCurrentStatus").textContent = student.faceDescriptor
    ? "✅ الطالب مسجّل بصمة وجه بالفعل - تقدر تلتقط بصمة جديدة تستبدلها لو حبيت"
    : "⚠️ لا توجد بصمة وجه مسجلة لهذا الطالب حتى الآن";

  e_subjectsWrap.innerHTML = "";
  const subjects = student.subjects || {};
  if (Object.keys(subjects).length === 0) addSubjectRow(e_subjectsWrap);
  else Object.values(subjects).forEach((s) => addSubjectRow(e_subjectsWrap, s));

  document.getElementById("editForm").classList.remove("hidden");
}

document.getElementById("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!e_currentCode) return;
  try {
    const updates = {
      name: document.getElementById("e_name").value.trim(),
      grade: document.getElementById("e_grade").value.trim(),
      parentPhone: document.getElementById("e_parentPhone").value.trim(),
      address: document.getElementById("e_address").value.trim(),
      studentNumber: document.getElementById("e_studentNumber").value.trim(),
      subjects: collectSubjects(e_subjectsWrap),
    };
    // ما بنعدلش بصمة الوجه المخزنة إلا لو الأدمن التقط بصمة جديدة فعلاً
    if (e_capturedFaceDescriptor) updates.faceDescriptor = e_capturedFaceDescriptor;

    await db.ref("students/" + e_currentCode).update(updates);
    showToast("تم حفظ التعديلات بنجاح", "success");
    if (e_capturedFaceDescriptor) {
      document.getElementById("e_faceCurrentStatus").textContent = "✅ الطالب مسجّل بصمة وجه بالفعل - تقدر تلتقط بصمة جديدة تستبدلها لو حبيت";
      e_capturedFaceDescriptor = null;
    }
  } catch (err) {
    showToast("حدث خطأ أثناء الحفظ: " + err.message, "error");
  }
});

document.getElementById("e_deleteBtn").addEventListener("click", async () => {
  if (!e_currentCode) return showToast("ابحث عن طالب أولاً", "error");
  if (!confirm("هل أنت متأكد من حذف هذا الطالب نهائياً؟ لا يمكن التراجع.")) return;
  try {
    await db.ref("students/" + e_currentCode).remove();
    showToast("تم حذف الطالب", "success");
    document.getElementById("editForm").classList.add("hidden");
    document.getElementById("e_code").value = "";
    e_currentCode = null;
  } catch (err) {
    showToast("حدث خطأ أثناء الحذف: " + err.message, "error");
  }
});

/* ==========================================================
   كارت الطالب (ID Card) - وجه وظهر جاهز للطباعة
   ========================================================== */
async function openStudentCard(code, name, grade) {
  document.getElementById("card_name").textContent = name || "-";
  document.getElementById("card_grade").textContent = grade || "-";

  // بيانات الإدارة/التواصل - قابلة للتعديل من الإعدادات، ولها قيم افتراضية جاهزة
  try {
    const snap = await db.ref("settings/systemConfig").get();
    const cfg = snap.exists() ? snap.val() : {};
    document.getElementById("card_managerName").textContent = cfg.cardManagerName || "أ/ أحمد جمال عمر";
    document.getElementById("card_phone1").textContent = cfg.cardPhone1 || "01143229861";
    document.getElementById("card_phone2").textContent = cfg.cardPhone2 || "01154782444";
    document.getElementById("card_address").textContent = cfg.cardAddress || "سنتر العلا فى الجديدة";
  } catch (e) { /* هتفضل شغالة بالقيم الافتراضية */ }

  // QR بيوديك لبروفايل الطالب مباشرة
  const qrBox = document.getElementById("card_qr");
  qrBox.innerHTML = "";
  new QRCode(qrBox, { text: SITE_BASE_URL + "student.html?id=" + code, width: 130, height: 130 });

  // باركود شريطي بكود الطالب، محاط بنجمتين زي الكارت الأصلي (تلقائي مع تنسيق CODE39)
  try {
    JsBarcode("#card_barcode", code, {
      format: "CODE39", displayValue: true, font: "monospace",
      fontSize: 13, textMargin: 2, height: 34, width: 1.8, margin: 4,
    });
  } catch (e) { console.error("فشل توليد الباركود:", e); }

  document.getElementById("studentCardModal").classList.remove("hidden");
}

document.getElementById("c_printCardBtn").addEventListener("click", () => {
  if (!c_lastCreated) return;
  openStudentCard(c_lastCreated.code, c_lastCreated.name, c_lastCreated.grade);
});

document.getElementById("e_printCardBtn").addEventListener("click", () => {
  if (!e_currentCode) return;
  openStudentCard(e_currentCode, document.getElementById("e_name").value, document.getElementById("e_grade").value);
});

document.getElementById("closeStudentCardModal").addEventListener("click", () => {
  document.getElementById("studentCardModal").classList.add("hidden");
});

document.getElementById("printStudentCardBtn").addEventListener("click", () => {
  printWithPageSize("print-id-card", "85.6mm 53.9mm", "0");
});

/* ==========================================================
   TAB: الحضور والانصراف (يدوي / باركود / كاميرا) - ذكي بالمعاد والدفع
   ========================================================== */
let html5QrCode = null;
let scanning = false;
let scanLock = false;

const manualCodeInput = document.getElementById("manualCodeInput");
manualCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const code = manualCodeInput.value.trim();
    if (code) handleAttendanceScan(code, { override: false });
    manualCodeInput.value = "";
  }
});

document.getElementById("toggleScanBtn").addEventListener("click", () => {
  if (!scanning) startScanner(); else stopScanner();
});

function startScanner() {
  if (faceScanning) stopFaceAttendance();
  html5QrCode = new Html5Qrcode("qr-reader");
  html5QrCode
    .start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onScanSuccess, () => {})
    .then(() => { scanning = true; document.getElementById("toggleScanBtn").textContent = "⏹ إيقاف الكاميرا"; })
    .catch((err) => showToast("تعذر تشغيل الكاميرا: " + err, "error"));
}
function stopScanner() {
  if (html5QrCode) html5QrCode.stop().then(() => { scanning = false; document.getElementById("toggleScanBtn").textContent = "📷 تشغيل الكاميرا (QR)"; });
}

/* ---------- الحضور ببصمة الوجه ---------- */
let attFaceStream = null;
let faceScanning = false;
let faceScanInterval = null;
let faceScanLock = false;

document.getElementById("toggleFaceBtn").addEventListener("click", () => {
  if (!faceScanning) startFaceAttendance(); else stopFaceAttendance();
});

async function startFaceAttendance() {
  if (scanning) stopScanner(); // ما نشغّلش كاميرا QR وكاميرا الوجه مع بعض
  const status = document.getElementById("att_faceStatus");
  document.getElementById("att_faceBox").classList.remove("hidden");
  status.className = ""; status.textContent = "⏳ جاري تحميل نظام التعرف على الوجه...";
  const ok = await loadFaceModels();
  if (!ok) { status.className = "face-status-err"; status.textContent = "⚠️ تعذر تحميل نظام بصمة الوجه (تأكد من الاتصال بالإنترنت)"; return; }
  try {
    attFaceStream = await startFaceCamera(document.getElementById("att_faceVideo"));
    faceScanning = true;
    document.getElementById("toggleFaceBtn").textContent = "⏹ إيقاف كاميرا بصمة الوجه";
    status.className = ""; status.textContent = "بيدور على وجه الطالب تلقائياً...";
    if (!Object.keys(studentsCache).length) {
      const snap = await db.ref("students").get();
      studentsCache = snap.exists() ? snap.val() : {};
    }
    faceScanInterval = setInterval(scanFaceForAttendance, 1200);
  } catch (err) {
    status.className = "face-status-err"; status.textContent = "تعذر تشغيل الكاميرا: " + err.message;
  }
}

function stopFaceAttendance() {
  clearInterval(faceScanInterval);
  stopFaceCamera(attFaceStream);
  faceScanning = false;
  document.getElementById("toggleFaceBtn").textContent = "🙂 تشغيل كاميرا بصمة الوجه";
  document.getElementById("att_faceBox").classList.add("hidden");
  document.getElementById("att_faceStatus").textContent = "";
}

async function scanFaceForAttendance() {
  if (faceScanLock) return;
  const video = document.getElementById("att_faceVideo");
  const status = document.getElementById("att_faceStatus");
  const descriptor = await detectFaceDescriptor(video);

  if (!descriptor) {
    // إصلاح: قبل كده كان بيسكت من غير ما يقول حاجة لو مفيش وجه واضح قدام الكاميرا
    status.className = "face-status-err";
    status.textContent = "🚫 مش شايف وش واضح قدام الكاميرا - قرّب وجهك واتأكد من الإضاءة";
    return;
  }

  const match = findBestFaceMatch(descriptor, studentsCache);
  if (!match) {
    status.className = "face-status-err";
    status.textContent = "⚠️ في وجه قدام الكاميرا بس مش متطابق مع أي طالب مسجّل بصمته - جرّب تقرّب أو حسّن الإضاءة";
    return;
  }

  faceScanLock = true;
  status.className = "face-status-ok"; status.textContent = "✅ تم التعرف على الطالب، جاري تسجيل الحضور...";
  await handleAttendanceScan(match.code, { override: false });
  setTimeout(() => { faceScanLock = false; if (faceScanning) { status.className = ""; status.textContent = "بيدور على وجه الطالب تلقائياً..."; } }, 4000);
}

function extractCodeFromText(text) {
  try {
    const url = new URL(text);
    const id = url.searchParams.get("id");
    if (id) return id;
  } catch (_) {}
  const match = text.match(/(\d{3,})/);
  return match ? match[1] : text.trim();
}

async function onScanSuccess(decodedText) {
  if (scanLock) return;
  scanLock = true;
  setTimeout(() => (scanLock = false), 3500);
  await handleAttendanceScan(extractCodeFromText(decodedText), { override: false });
}

async function handleAttendanceScan(code, { override }) {
  const resultBox = document.getElementById("scanResult");
  const snap = await db.ref("students/" + code).get();
  if (!snap.exists()) {
    resultBox.className = "scan-result";
    resultBox.innerHTML = "❌ كود غير معروف: " + escapeHtml(code);
    resultBox.classList.remove("hidden");
    return;
  }
  const student = snap.val();

  // 1) تحقق من الدفع
  if (!override) {
    const payStatus = isStudentPaidThisMonth(student);
    if (!payStatus.paid) {
      resultBox.className = "scan-result";
      resultBox.innerHTML = `
        <strong>⚠️ ${escapeHtml(student.name)} لسه مادفعش مصاريف الشهر ده</strong>
        <div style="font-size:12.5px; color:var(--text-mid); margin:6px 0;">مواد لسه ما اتدفعتش: ${payStatus.unpaidSubjects.map((s) => escapeHtml(s.name)).join("، ")}</div>
        <div style="display:flex; gap:10px; justify-content:center; margin-top:10px;">
          <button class="btn btn-outline" id="overrideAttBtn">تسجيل الحضور رغم عدم الدفع</button>
          <button class="btn btn-primary" id="goPayBtn">الذهاب لتبويب المصروفات</button>
        </div>`;
      resultBox.classList.remove("hidden");
      document.getElementById("overrideAttBtn").addEventListener("click", () => handleAttendanceScan(code, { override: true }));
      document.getElementById("goPayBtn").addEventListener("click", () => {
        goToTab("payments");
        document.getElementById("pay_code").value = code;
        searchStudentForPayments();
      });
      return;
    }
  }

  // 2) تحقق ذكي من اليوم + المعاد معاً (لو الطالب عندو مواد بمواعيد محددة)
  const subjectsList = Object.values(student.subjects || {}).filter((s) => s.time);
  if (!override && subjectsList.length && !isScheduledNow(subjectsList, GRACE_MINUTES)) {
    const scheduleLines = subjectsList.map((s) => `${escapeHtml(s.name)}: ${parseDaysCsv(s.day).join("، ") || "بدون أيام محددة"} - الساعة ${escapeHtml(s.time)}`).join("<br>");
    resultBox.className = "scan-result";
    resultBox.innerHTML = `
      <strong>⛔ ${escapeHtml(student.name)} ليس له معاد الآن (اليوم: ${todayDayNameAr()})</strong>
      <div style="font-size:12.5px; color:var(--text-mid); margin:6px 0;">المواعيد المسجلة:<br>${scheduleLines}</div>
      <button class="btn btn-outline" id="overrideScheduleBtn" style="margin-top:8px;">تسجيل الحضور يدوياً رغم ذلك</button>`;
    resultBox.classList.remove("hidden");
    document.getElementById("overrideScheduleBtn").addEventListener("click", () => handleAttendanceScan(code, { override: true }));
    return;
  }

  await proceedAttendance(code, student, resultBox);
}

async function proceedAttendance(code, student, resultBox) {
  const today = todayKey();
  const attendance = student.attendance || {};
  const todaysEntries = Object.entries(attendance).filter(([, v]) => v.date === today);
  const openIn = todaysEntries.find(([, v]) => v.type === "in" && !v.checkedOut);

  const now = new Date();
  const timeStr = formatTimeArabic(now);
  const minutes = nowMinutes();

  let message, type;
  if (!openIn) {
    await db.ref("students/" + code + "/attendance").push({ date: today, type: "in", time: timeStr, timeMinutes: minutes, timestamp: now.toISOString(), checkedOut: false });
    type = "in";
    message = `مرحباً، تم تسجيل حضور الطالب ${student.name} اليوم الساعة ${timeStr} - Al Ola Center`;
    resultBox.className = "scan-result in";
    // بمجرد ما الطالب يسجل حضوره (بأي طريقة: كود، باركود، أو بصمة وجه)، يتشال فوراً من قائمة الغائبين اليوم
    db.ref(`absentees/${today}/${code}`).remove().catch(() => {});
  } else {
    const [key] = openIn;
    await db.ref(`students/${code}/attendance/${key}`).update({ checkedOut: true, outTime: timeStr });
    await db.ref("students/" + code + "/attendance").push({ date: today, type: "out", time: timeStr, timeMinutes: minutes, timestamp: now.toISOString() });
    type = "out";
    message = `تم تسجيل انصراف الطالب ${student.name} اليوم الساعة ${timeStr} - Al Ola Center`;
    resultBox.className = "scan-result out";
  }

  const waPhone = student.parentPhone;
  resultBox.innerHTML = `
    <strong>${type === "in" ? "✅ تم تسجيل حضور" : "👋 تم تسجيل انصراف"}</strong><br>
    ${escapeHtml(student.name)} - الساعة ${timeStr}
    <div style="margin-top:10px;" id="scanWaSlot"></div>
  `;
  resultBox.classList.remove("hidden");
  playNotifySound();
  document.getElementById("scanWaSlot").appendChild(renderWhatsAppControl(waPhone, message));

  loadTodayAttendance();
  loadOverview();
}

async function loadTodayAttendance() {
  const tbody = document.querySelector("#attTable tbody");
  const emptyBox = document.getElementById("attEmpty");
  const snap = await db.ref("students").get();
  if (!snap.exists()) return;

  studentsCache = snap.val();
  const today = todayKey();
  let rows = [];

  Object.entries(studentsCache).forEach(([code, s]) => {
    Object.values(s.attendance || {}).forEach((a) => {
      if (a.date === today) rows.push({ code, name: s.name, type: a.type, time: a.time });
    });
  });

  rows.sort((a, b) => (a.time < b.time ? 1 : -1));
  tbody.innerHTML = "";
  if (!rows.length) {
    emptyBox.classList.remove("hidden");
    document.getElementById("attTable").classList.add("hidden");
    return;
  }
  emptyBox.classList.add("hidden");
  document.getElementById("attTable").classList.remove("hidden");

  rows.forEach((r) => {
    const badge = r.type === "in" ? '<span class="badge success">حضور</span>' : '<span class="badge pending">انصراف</span>';
    tbody.appendChild(el(`<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.name)}</td><td>${badge}</td><td>${escapeHtml(r.time)}</td></tr>`));
  });
}

// ----- فاتهم معادهم النهاردة -----
async function refreshMissedList() {
  const wrap = document.getElementById("missedList");
  const empty = document.getElementById("missedEmpty");
  const snap = await db.ref("students").get();
  if (!snap.exists()) { wrap.innerHTML = ""; empty.classList.remove("hidden"); return; }

  studentsCache = snap.val();
  const today = todayKey();
  const now = nowMinutes();
  const missed = [];

  Object.entries(studentsCache).forEach(([code, s]) => {
    const subjects = Object.values(s.subjects || {}).filter((sub) => sub.time);
    if (!subjects.length) return;

    const attendedTimes = Object.values(s.attendance || {})
      .filter((a) => a.type === "in" && a.date === today && typeof a.timeMinutes === "number")
      .map((a) => a.timeMinutes);

    const missedSubjects = subjects.filter((sub) => {
      const tm = timeToMinutes(sub.time);
      if (tm === null) return false;
      const passed = now - tm > LATE_MINUTES; // المعاد فات
      if (!passed) return false;
      const matched = attendedTimes.some((am) => Math.abs(am - tm) <= GRACE_MINUTES);
      return !matched;
    });

    if (missedSubjects.length) missed.push({ code, name: s.name, phone: s.parentPhone, subjects: missedSubjects });
  });

  if (!missed.length) { wrap.innerHTML = ""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  wrap.innerHTML = "";

  missed.forEach((m) => {
    const row = el(`
      <div class="pay-row">
        <div class="info"><b>${escapeHtml(m.name)} (${escapeHtml(m.code)})</b>فاته: ${m.subjects.map((s) => escapeHtml(s.name) + " - " + escapeHtml(s.time)).join(" / ")}</div>
        <div></div>
      </div>`);
    const msg = `تنبيه: الطالب ${m.name} لم يحضر معاده اليوم (${m.subjects.map((s) => s.time).join(" - ")}) في Al Ola Center`;
    row.lastElementChild.appendChild(renderWhatsAppControl(m.phone, msg));
    wrap.appendChild(row);
  });
}

/* ==========================================================
   TAB: المصروفات
   ========================================================== */
let pay_currentCode = null;
let pay_currentStudent = null;

function buildMonthOptions() {
  const now = new Date();
  const options = [];
  for (let offset = -2; offset <= 2; offset++) {
    options.push(currentMonthKey(new Date(now.getFullYear(), now.getMonth() + offset, 1)));
  }
  return options;
}

document.getElementById("pay_searchBtn").addEventListener("click", searchStudentForPayments);
document.getElementById("pay_code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchStudentForPayments(); } });
document.getElementById("pay_monthSelect").addEventListener("change", (e) => {
  if (pay_currentStudent) renderPaymentSubjects(pay_currentCode, pay_currentStudent, e.target.value);
});

async function searchStudentForPayments() {
  const code = document.getElementById("pay_code").value.trim();
  if (!code) return showToast("اكتب كود الطالب أولاً", "error");
  const snap = await db.ref("students/" + code).get();
  if (!snap.exists()) return showToast("لا يوجد طالب بهذا الكود", "error");

  const student = snap.val();
  pay_currentCode = code;
  pay_currentStudent = student;

  document.getElementById("pay_studentName").textContent = `${student.name} - كود ${code}`;
  document.getElementById("pay_studentBox").classList.remove("hidden");

  const monthSel = document.getElementById("pay_monthSelect");
  const months = buildMonthOptions();
  const currentMk = currentMonthKey();
  monthSel.innerHTML = months.map((mk) => `<option value="${mk}" ${mk === currentMk ? "selected" : ""}>${monthLabel(mk)}${mk === currentMk ? " (الشهر الحالي)" : ""}</option>`).join("");

  renderPaymentSubjects(code, student, currentMk);
}

function renderPaymentSubjects(code, student, monthKey) {
  document.getElementById("pay_monthLabel").textContent = monthLabel(monthKey);
  // إصلاح تكرار المطالبة بالدفع: تجميع كل المجموعات التابعة لنفس المدرس كمادة واحدة بس
  const billingGroups = getBillingGroups(student.subjects);
  const wrap = document.getElementById("pay_subjectsWrap");
  const noSubjects = document.getElementById("pay_noSubjects");
  wrap.innerHTML = "";

  if (!billingGroups.length) { noSubjects.classList.remove("hidden"); return; }
  noSubjects.classList.add("hidden");

  const payments = (student.payments || {})[monthKey] || {};
  const isPastMonth = monthKey < currentMonthKey(); // الشهور اللي فاتت تُعرض للمراجعة بس، مش قابلة للتعديل

  billingGroups.forEach((g) => {
    const isPaid = isBillingGroupPaid(g, payments);
    const locked = isPaid || isPastMonth;
    const groupsCountNote = g.subjectKeys.length > 1 ? ` <span style="color:var(--text-light); font-weight:400;">(${g.subjectKeys.length} مجموعات مربوطة - بتتحسب مرة واحدة)</span>` : "";
    const row = el(`
      <div class="pay-row">
        <div class="info"><b>${escapeHtml(g.name)}</b>${escapeHtml(g.fee || 0)} جنيه - ${escapeHtml(g.day || "")}${groupsCountNote} ${isPaid ? '<span class="badge success" style="margin-right:6px;">مؤكد ومقفول 🔒</span>' : isPastMonth ? '<span class="badge pending" style="margin-right:6px;">لم يُدفع (شهر سابق)</span>' : ""}</div>
        <div class="pay-toggle">
          <button type="button" class="yes ${isPaid ? "active" : ""}" data-yes ${locked ? "disabled" : ""}>✓</button>
          <button type="button" class="no ${!isPaid ? "active" : ""}" data-no ${locked ? "disabled" : ""}>✗</button>
        </div>
      </div>`);

    row.querySelector("[data-yes]").addEventListener("click", async () => {
      // قفل نهائي: بمجرد تعليم الصح ما ينفعش يتلغي تاني
      // وبيتطبق على كل المجموعات المرتبطة بنفس المدرس/المادة لنفس الشهر مرة واحدة تلقائياً
      const updates = {};
      g.subjectKeys.forEach((k) => (updates[k] = true));
      await db.ref(`students/${code}/payments/${monthKey}`).update(updates);
      row.querySelector("[data-yes]").classList.add("active");
      row.querySelector("[data-yes]").disabled = true;
      row.querySelector("[data-no]").classList.remove("active");
      row.querySelector("[data-no]").disabled = true;
      const msg = `تم تأكيد دفع مصاريف "${g.name}" لشهر ${monthLabel(monthKey)} للطالب ${student.name} - Al Ola Center. شكراً لكم.`;
      showToast("تم تسجيل الدفع وقفل التأكيد", "success");
      playNotifySound();
      loadOverview();
      const waSlot = el('<div style="margin-top:8px;"></div>');
      waSlot.appendChild(renderWhatsAppControl(student.parentPhone, msg));
      row.appendChild(waSlot);
    });

    row.querySelector("[data-no]").addEventListener("click", async () => {
      const updates = {};
      g.subjectKeys.forEach((k) => (updates[k] = null));
      await db.ref(`students/${code}/payments/${monthKey}`).update(updates);
      row.querySelector("[data-no]").classList.add("active");
      row.querySelector("[data-yes]").classList.remove("active");
      showToast("تم تعليم المادة كغير مدفوعة", "success");
      loadOverview();
    });

    wrap.appendChild(row);
  });
}

// ----- طلبات الدفع الأونلاين -----
async function loadPaymentRequests() {
  const wrap = document.getElementById("pay_requestsList");
  const empty = document.getElementById("pay_requestsEmpty");
  // إصلاح: بدل ما نعتمد على orderByChild("status") اللي محتاجة .indexOn معرّف صح في Database Rules
  // (وأي خطأ فيها كان بيسبب اختفاء الطلبات بصمت من غير أي رسالة خطأ)، بنجيب كل الطلبات ونفلترها
  // في المتصفح نفسه - ده بيشتغل مهما كانت الـ Rules، وأي خطأ صلاحيات هيظهر واضح كـ Toast.
  db.ref("paymentRequests").on(
    "value",
    (snap) => {
      wrap.innerHTML = "";
      const all = snap.exists() ? snap.val() : {};
      const requests = Object.fromEntries(Object.entries(all).filter(([, r]) => r && r.status === "pending"));
      // تحسين أداء: تحديث شارة "المصروفات" من نفس البيانات اللي وصلت من الـ listener ده
      // بدل ما يكون فيه اشتراك تاني منفصل بيعيد تحميل نفس المجموعة تاني من الصفر
      updateTabBadge("payments", Object.keys(requests).length);
      if (!Object.keys(requests).length) { empty.classList.remove("hidden"); return; }
      empty.classList.add("hidden");

      Object.entries(requests).forEach(([reqId, r]) => {
        const card = el(`
          <div class="request-card">
            <div class="top">
              <b>${escapeHtml(r.name)} (${escapeHtml(r.code)})</b>
              <span style="font-size:12px; color:var(--text-mid);">${escapeHtml(r.createdAt ? formatDateArabic(r.createdAt) : "")}</span>
            </div>
            <div style="font-size:13px; color:var(--text-mid);">
              المادة: ${escapeHtml(r.subjectName || "-")} | الشهر: ${escapeHtml(monthLabel(r.month || currentMonthKey()))} | المبلغ: ${escapeHtml(r.amount || "-")} ج
            </div>
            <div style="font-size:13px; color:var(--text-mid); margin-top:4px;">رقم التحويل: ${escapeHtml(r.phone || "-")}</div>
            ${r.image ? `<img src="${r.image}" alt="إيصال">` : ""}
            <div class="actions">
              <button class="btn btn-primary" data-approve>✓ تأكيد الدفع</button>
              <button class="btn btn-danger" data-reject>✕ رفض</button>
            </div>
          </div>`);

        card.querySelector("[data-approve]").addEventListener("click", async () => {
          const amount = Number(r.amount) || 0; // ضمان إن المبلغ رقم فعلي مش نص، عشان الإجمالي يتحدث صح
          // بيدعم subjectKeys (مصفوفة - كل المجموعات المرتبطة بنفس المدرس/المادة) وكمان subjectKey
          // القديمة (توافقاً مع أي طلبات اتبعتت قبل هذا التحديث)
          const keysToMark = Array.isArray(r.subjectKeys) && r.subjectKeys.length ? r.subjectKeys : (r.subjectKey ? [r.subjectKey] : []);
          if (keysToMark.length) {
            const updates = {};
            keysToMark.forEach((k) => (updates[k] = true));
            await db.ref(`students/${r.code}/payments/${r.month}`).update(updates);
          }
          await db.ref(`paymentRequests/${reqId}`).update({ status: "approved", amount });
          playNotifySound();
          showToast("تم تأكيد الدفع", "success");
          const msg = `تم تأكيد دفع مصاريف "${r.subjectName || ""}" لشهر ${monthLabel(r.month || currentMonthKey())} للطالب ${r.name} - Al Ola Center. شكراً لكم.`;
          card.querySelector(".actions").innerHTML = "";
          card.querySelector(".actions").appendChild(renderWhatsAppControl(r.phone, msg));
          loadOverview();
        });
        card.querySelector("[data-reject]").addEventListener("click", async () => {
          await db.ref(`paymentRequests/${reqId}`).update({ status: "rejected" });
          showToast("تم رفض الطلب", "success");
          loadOverview();
        });

        wrap.appendChild(card);
      });
    },
    (err) => {
      console.error("فشل تحميل طلبات الدفع الأونلاين:", err);
      showToast("تعذر تحميل طلبات الدفع الأونلاين - راجع صلاحيات قاعدة البيانات (Database Rules) لمسار paymentRequests", "error");
    }
  );
}

/* ==========================================================
   TAB: ملاحظات (فردي / حسب الصف والمادة / للجميع)
   ========================================================== */
let n_currentCode = null;

document.getElementById("n_mode").addEventListener("change", async (e) => {
  const mode = e.target.value;
  document.getElementById("n_singleBox").classList.toggle("hidden", mode !== "single");
  document.getElementById("n_filterBox").classList.toggle("hidden", mode !== "filter");
  document.getElementById("n_allBox").classList.toggle("hidden", mode !== "all");
  document.getElementById("n_listTitle").classList.toggle("hidden", mode !== "single");
  document.getElementById("n_list").classList.toggle("hidden", mode !== "single");
  document.getElementById("n_empty").classList.add("hidden");

  if (mode === "filter") await populateNotesFilterOptions();
  if (mode === "all") {
    const all = Object.keys(studentsCache).length || Object.keys((await db.ref("students").get()).val() || {}).length;
    document.getElementById("n_allCount").textContent = all;
  }
});

async function populateNotesFilterOptions() {
  if (!Object.keys(studentsCache).length) {
    const snap = await db.ref("students").get();
    studentsCache = snap.exists() ? snap.val() : {};
  }
  const grades = new Set();
  const subjectNames = new Set();
  Object.values(studentsCache).forEach((s) => {
    if (s.grade) grades.add(s.grade);
    Object.values(s.subjects || {}).forEach((sub) => { if (sub.name) subjectNames.add(sub.name); });
  });
  const gradeSel = document.getElementById("n_filterGrade");
  const subjSel = document.getElementById("n_filterSubject");
  const prevGrade = gradeSel.value, prevSubj = subjSel.value;
  gradeSel.innerHTML = '<option value="">كل الصفوف</option>' + [...grades].sort().map((g) => `<option value="${escapeHtml(g)}" ${g === prevGrade ? "selected" : ""}>${escapeHtml(g)}</option>`).join("");
  subjSel.innerHTML = '<option value="">كل المواد</option>' + [...subjectNames].sort().map((s) => `<option value="${escapeHtml(s)}" ${s === prevSubj ? "selected" : ""}>${escapeHtml(s)}</option>`).join("");
  updateNotesFilterCount();
}

function getFilteredNotesTargets() {
  const grade = document.getElementById("n_filterGrade").value;
  const subject = document.getElementById("n_filterSubject").value;
  return Object.entries(studentsCache).filter(([, s]) => {
    if (grade && s.grade !== grade) return false;
    if (subject && !Object.values(s.subjects || {}).some((sub) => sub.name === subject)) return false;
    return true;
  });
}

function updateNotesFilterCount() {
  const count = getFilteredNotesTargets().length;
  document.getElementById("n_filterCount").textContent = `عدد الطلاب المستهدفين حالياً: ${count} طالب`;
}
document.getElementById("n_filterGrade").addEventListener("change", updateNotesFilterCount);
document.getElementById("n_filterSubject").addEventListener("change", updateNotesFilterCount);

document.getElementById("n_searchBtn").addEventListener("click", searchStudentForNotes);
document.getElementById("n_code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchStudentForNotes(); } });

async function searchStudentForNotes() {
  const code = document.getElementById("n_code").value.trim();
  if (!code) return showToast("اكتب كود الطالب أولاً", "error");
  const snap = await db.ref("students/" + code).get();
  if (!snap.exists()) return showToast("لا يوجد طالب بهذا الكود", "error");

  const student = snap.val();
  n_currentCode = code;
  document.getElementById("n_studentName").textContent = `${student.name} - كود ${code}`;
  document.getElementById("n_studentBox").classList.remove("hidden");
  renderNotesList(student.notes || {});
}

async function sendNoteToStudent(code, student, text) {
  await db.ref("students/" + code + "/notes").push({ text, createdAt: new Date().toISOString() });
  return student.parentPhone;
}

document.getElementById("n_sendBtn").addEventListener("click", async () => {
  const mode = document.getElementById("n_mode").value;
  const text = document.getElementById("n_text").value.trim();
  if (!text) return showToast("اكتب نص الملاحظة أولاً", "error");

  const waSlot = document.getElementById("n_waSlot");
  waSlot.innerHTML = "";

  if (mode === "single") {
    if (!n_currentCode) return showToast("دور على طالب أولاً بالكود", "error");
    const snap = await db.ref("students/" + n_currentCode).get();
    const student = snap.val();
    const phone = await sendNoteToStudent(n_currentCode, student, text);
    document.getElementById("n_text").value = "";
    showToast("تم حفظ الملاحظة", "success");
    waSlot.appendChild(renderWhatsAppControl(phone, `ملاحظة من Al Ola Center بخصوص الطالب ${student.name}:\n${text}`));
    const newSnap = await db.ref("students/" + n_currentCode + "/notes").get();
    renderNotesList(newSnap.val() || {});
    return;
  }

  // بث موجّه (حسب الصف/المادة) أو للجميع
  const targets = mode === "all" ? Object.entries(studentsCache) : getFilteredNotesTargets();
  if (!targets.length) return showToast("لا يوجد طلاب مطابقين لمعايير الاختيار", "error");
  if (!confirm(`هيتم إرسال نفس الملاحظة لـ ${targets.length} طالب. متابعة؟`)) return;

  showToast(`جاري الإرسال لـ ${targets.length} طالب...`, "default");
  const listWrap = el('<div style="display:flex; flex-direction:column; gap:8px;"></div>');
  for (const [code, student] of targets) {
    await sendNoteToStudent(code, student, text);
    const row = el(`<div class="pay-row"><div class="info"><b>${escapeHtml(student.name)}</b> (${escapeHtml(code)})</div><div></div></div>`);
    row.lastElementChild.appendChild(renderWhatsAppControl(student.parentPhone, `ملاحظة من Al Ola Center بخصوص الطالب ${student.name}:\n${text}`));
    listWrap.appendChild(row);
  }
  waSlot.appendChild(listWrap);
  document.getElementById("n_text").value = "";
  showToast(`تم حفظ وإرسال الملاحظة لـ ${targets.length} طالب`, "success");
});

function renderNotesList(notes) {
  const wrap = document.getElementById("n_list");
  const empty = document.getElementById("n_empty");
  const entries = Object.values(notes || {}).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (!entries.length) { wrap.innerHTML = ""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  wrap.innerHTML = entries.map((n) => `<div class="note-card"><div class="txt">${escapeHtml(n.text)}</div><div class="meta">${escapeHtml(formatDateArabic(n.createdAt))}</div></div>`).join("");
}

/* ==========================================================
   TAB: عدد الطلاب في المجموعة (Groups Overview)
   ========================================================== */
async function loadGroupsOverview() {
  const snap = await db.ref("students").get();
  studentsCache = snap.exists() ? snap.val() : {};
  document.getElementById("gr_totalAll").textContent = Object.keys(studentsCache).length;

  const today = todayKey();
  const presentTodaySet = new Set();
  Object.entries(studentsCache).forEach(([code, s]) => {
    Object.values(s.attendance || {}).forEach((a) => { if (a.type === "in" && a.date === today) presentTodaySet.add(code); });
  });
  document.getElementById("gr_presentToday").textContent = presentTodaySet.size;

  const wrap = document.getElementById("groupsOverviewList");
  const empty = document.getElementById("groupsOverviewEmpty");
  wrap.innerHTML = "";
  const entries = Object.entries(teachersCache).filter(([, t]) => t.groups && Object.keys(t.groups).length);
  if (!entries.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  entries.forEach(([teacherId, t]) => {
    const card = el(`<div class="teacher-card"><div class="t-head"><div class="t-name">🧑‍🏫 ${escapeHtml(t.name)}</div></div><div class="groups-pills" data-list></div></div>`);
    const listWrap = card.querySelector("[data-list]");
    Object.entries(t.groups).forEach(([groupId, g]) => {
      const enrolled = Object.entries(studentsCache).filter(([, s]) =>
        Object.values(s.subjects || {}).some((sub) => sub.teacherId === teacherId && sub.groupId === groupId)
      );
      const presentTodayCount = enrolled.filter(([code]) => presentTodaySet.has(code)).length;
      listWrap.appendChild(el(`<span class="group-pill">${escapeHtml(g.label)} - ${escapeHtml(parseDaysCsv(g.day).join("، "))} - ${escapeHtml(g.time)} <span class="count">${enrolled.length} طالب</span> <span style="color:var(--teal); font-weight:700; margin-right:4px;">(${presentTodayCount} حضروا اليوم)</span></span>`));
    });
    wrap.appendChild(card);
  });
}

/* ==========================================================
   TAB: الغائبين (كشف تلقائي + إرسال واتساب بضغطة)
   ========================================================== */
let absenteesCache = {};

async function detectAndLogAbsentees() {
  if (!Object.keys(studentsCache).length) {
    const snap = await db.ref("students").get();
    studentsCache = snap.exists() ? snap.val() : {};
  }
  const today = todayKey();
  const now = nowMinutes();
  const found = [];

  Object.entries(studentsCache).forEach(([code, s]) => {
    const subjects = Object.values(s.subjects || {}).filter((sub) => sub.time);
    if (!subjects.length) return;

    // تجميع مواد نفس المدرس مع بعض عشان لو الطالب معاه أكتر من مجموعة لنفس المدرس النهاردة،
    // ننتظر آخر معاد بينهم بس (زي المطلوب بالظبط)
    const byTeacher = {};
    subjects.forEach((sub) => {
      const key = sub.teacherId || "solo_" + sub.name;
      (byTeacher[key] = byTeacher[key] || []).push(sub);
    });

    const attendedToday = Object.values(s.attendance || {}).filter((a) => a.type === "in" && a.date === today);
    const attendedTimes = attendedToday.map((a) => a.timeMinutes).filter((t) => typeof t === "number");

    Object.values(byTeacher).forEach((group) => {
      let lastSub = null, lastTm = -1;
      group.forEach((sub) => {
        const tm = timeToMinutes(sub.time);
        if (tm !== null && tm > lastTm) { lastTm = tm; lastSub = sub; }
      });
      if (!lastSub || lastTm === -1) return;
      if (now - lastTm <= LATE_MINUTES) return; // المعاد لسه ماجاش
      const matched = attendedTimes.some((am) => Math.abs(am - lastTm) <= GRACE_MINUTES);
      if (matched) return;
      found.push({ code, name: s.name, phone: s.parentPhone, time: lastSub.time, subjectNames: group.map((g) => g.name) });
    });
  });

  // تسجيل في قاعدة البيانات (بدون تكرار لو مسجل قبل كده اليوم)
  for (const f of found) {
    try {
      const ref = db.ref(`absentees/${today}/${f.code}`);
      const existing = await ref.get();
      if (!existing.exists()) {
        await ref.set({ name: f.name, phone: f.phone || "", time: f.time, subjects: f.subjectNames, status: "pending", detectedAt: Date.now() });
      }
    } catch (e) {}
  }
  return found;
}

function startAutoAbsenceChecker() {
  detectAndLogAbsentees();
  attachAbsenteesListener(); // اشتراك مباشر (realtime) في قائمة اليوم - تحديث فوري بدون أي تدخل يدوي
  // فحص دوري كل دقيقة طول ما لوحة الأدمن مفتوحة (زي ما موضح في README، الإرسال الآلي 100%
  // بدون فتح لوحة الأدمن محتاج سيرفر خلفي / Cloud Functions، مش متاح في موقع static عادي)
  setInterval(() => {
    attachAbsenteesListener(); // بيتحقق لو اليوم اتغيّر (تجديد تلقائي للقائمة كل 24 ساعة) ويحوّل الاشتراك لليوم الجديد
    detectAndLogAbsentees().then(() => loadOverview());
  }, 60000);
}

/* إصلاح/تطوير: بدل ما القائمة تتحدث بس لما تفتح التاب أو تضغط تحديث، بقت مشتركة (realtime listener)
   في مسار اليوم الحالي مباشرة - أي تغيير (تسجيل غياب جديد، حذف، تأكيد إرسال) بيظهر فوراً بدون أي تدخل.
   وبما إن المسار مبني على تاريخ اليوم (absentees/{today})، ساعة ما اليوم يتغيّر (كل 24 ساعة) بيتم
   تلقائياً تحويل الاشتراك لمسار اليوم الجديد (فاضي) - وده هو "التحديث التلقائي كل 24 ساعة" المطلوب. */
let absenteesListenerDate = null;
let absenteesListenerRef = null;

function attachAbsenteesListener() {
  const today = todayKey();
  if (absenteesListenerDate === today) return; // مشترك في نفس يوم النهاردة أصلاً
  if (absenteesListenerRef) absenteesListenerRef.off();
  absenteesListenerDate = today;
  absenteesListenerRef = db.ref("absentees/" + today);
  absenteesListenerRef.on("value", (snap) => {
    absenteesCache = snap.exists() ? snap.val() : {};
    renderAbsenteesList();
  });
}

async function refreshAbsenteesList() {
  attachAbsenteesListener();
  await detectAndLogAbsentees(); // فحص فوري لأي غياب جديد - القائمة هترندر نفسها تلقائياً عبر الـ listener
}

function renderAbsenteesList() {
  const today = todayKey();
  const wrap = document.getElementById("absenteesList");
  const empty = document.getElementById("absenteesEmpty");
  wrap.innerHTML = "";
  const entries = Object.entries(absenteesCache);
  updateTabBadge("absentees", entries.filter(([, a]) => a && a.status !== "sent").length);
  if (!entries.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  entries.forEach(([code, a]) => {
    const row = el(`
      <div class="pay-row">
        <div class="info"><b>${escapeHtml(a.name)} (${escapeHtml(code)})</b>معاده كان: ${escapeHtml(a.time)} - ${escapeHtml((a.subjects || []).join("، "))}
          <span class="badge ${a.status === "sent" ? "success" : "pending"}">${a.status === "sent" ? "تم إرسال التنبيه ✓" : "لم يتم الإرسال بعد"}</span>
        </div>
        <div></div>
      </div>`);
    const btn = el(`<button class="btn ${a.status === "sent" ? "btn-outline" : "btn-danger"}">📱 ${a.status === "sent" ? "إعادة الإرسال" : "إرسال تنبيه"}</button>`);
    btn.addEventListener("click", async () => {
      const msg = `تنبيه غياب: الطالب ${a.name} لم يحضر معاده اليوم (${a.time}) في Al Ola Center`;
      sendWhatsApp(a.phone, msg);
      await db.ref(`absentees/${today}/${code}/status`).set("sent");
    });
    const delBtn = el(`<button class="btn btn-outline" title="حذف من قائمة الغائبين اليوم" style="margin-right:6px;">🗑️</button>`);
    delBtn.addEventListener("click", async () => {
      if (!confirm(`تأكيد حذف ${a.name} من قائمة الغائبين اليوم؟`)) return;
      await db.ref(`absentees/${today}/${code}`).remove();
      showToast("تم حذف السجل من قائمة الغائبين", "success");
    });
    row.lastElementChild.appendChild(btn);
    row.lastElementChild.appendChild(delBtn);
    wrap.appendChild(row);
  });
}

document.getElementById("ab_refreshBtn").addEventListener("click", refreshAbsenteesList);
document.getElementById("ab_sendAllBtn").addEventListener("click", async () => {
  const today = todayKey();
  const pending = Object.entries(absenteesCache).filter(([, a]) => a.status !== "sent");
  if (!pending.length) return showToast("لا يوجد غائبين محتاجين إرسال حالياً", "success");

  const GAP_MS = 72000; // فاصل زمني 1.2 دقيقة (72 ثانية) بين كل رسالة والتانية
  const estMinutes = Math.ceil((pending.length - 1) * 1.2);
  if (!confirm(`هيتم إرسال ${pending.length} رسالة واتساب، رسالة كل 1.2 دقيقة (المفروض ياخد حوالي ${estMinutes} دقيقة). سيب الصفحة مفتوحة لحد ما يخلص. متابعة؟`)) return;

  const btn = document.getElementById("ab_sendAllBtn");
  const originalText = btn.textContent;
  btn.disabled = true;

  for (let i = 0; i < pending.length; i++) {
    const [code, a] = pending[i];
    btn.textContent = `📱 جاري الإرسال (${i + 1} / ${pending.length})...`;
    const msg = `تنبيه غياب: الطالب ${a.name} لم يحضر معاده اليوم (${a.time}) في Al Ola Center`;
    sendWhatsApp(a.phone, msg);
    await db.ref(`absentees/${today}/${code}/status`).set("sent");
    if (i < pending.length - 1) await sleep(GAP_MS);
  }

  btn.disabled = false;
  btn.textContent = originalText;
  showToast("تم إرسال كل الرسائل", "success");
});
document.getElementById("ab_deleteAllBtn").addEventListener("click", async () => {
  const today = todayKey();
  const count = Object.keys(absenteesCache).length;
  if (!count) return showToast("قائمة الغائبين فاضية أصلاً", "success");
  if (!confirm(`تأكيد حذف كل قائمة الغائبين اليوم (${count} طالب)؟ الحذف نهائي.`)) return;
  await db.ref(`absentees/${today}`).remove();
  showToast("تم حذف كل قائمة الغائبين لليوم", "success");
});

/* ==========================================================
   TAB: الشكاوى والاستفسارات (Support Chat Inbox)
   ========================================================== */
let currentSupportCode = null;

async function loadSupportInbox() {
  const snap = await db.ref("supportChats").get();
  const wrap = document.getElementById("supportConvList");
  const empty = document.getElementById("supportConvEmpty");
  wrap.innerHTML = "";
  if (!snap.exists()) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  const chats = snap.val();
  const entries = Object.entries(chats).sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0));
  entries.forEach(([code, c]) => {
    const msgs = Object.values(c.messages || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
    const last = msgs[msgs.length - 1];
    const hasNew = last && last.from === "student";
    const row = el(`<div class="student-list-row" style="cursor:pointer;"><span class="name">${escapeHtml(c.studentName || code)} ${hasNew ? '<span class="badge danger">جديد</span>' : ""}</span><span class="code">${escapeHtml(code)}</span></div>`);
    row.addEventListener("click", () => openSupportConversation(code, c));
    wrap.appendChild(row);
  });
}

function openSupportConversation(code, chat) {
  currentSupportCode = code;
  const wrap = document.getElementById("supportMessages");
  const msgs = Object.values(chat.messages || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
  wrap.innerHTML = msgs
    .map((m) => `<div style="text-align:${m.from === "admin" ? "left" : "right"}; margin-bottom:6px;"><span style="display:inline-block; background:${m.from === "admin" ? "var(--purple-light,#ece9fb)" : "var(--bg)"}; padding:6px 10px; border-radius:8px; font-size:13px;">${escapeHtml(m.text)}</span></div>`)
    .join("");
  document.getElementById("supportReplyBox").classList.remove("hidden");
}

document.getElementById("supportReplyBtn").addEventListener("click", async () => {
  if (!currentSupportCode) return;
  const input = document.getElementById("supportReplyInput");
  const text = input.value.trim();
  if (!text) return;
  await db.ref(`supportChats/${currentSupportCode}/messages`).push({ text, from: "admin", at: Date.now() });
  await db.ref(`supportChats/${currentSupportCode}/lastAt`).set(Date.now());
  input.value = "";
  const snap = await db.ref("supportChats/" + currentSupportCode).get();
  openSupportConversation(currentSupportCode, snap.val());
  loadSupportInbox();
});

// حذف المحادثات القديمة تلقائياً (أكتر من 24 ساعة على آخر رسالة) - بيتم فحصها كل ما لوحة الأدمن تفتح
async function cleanupOldSupportChats() {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const snap = await db.ref("supportChats").get();
    if (!snap.exists()) return;
    const updates = {};
    Object.entries(snap.val()).forEach(([code, c]) => {
      if ((c.lastAt || 0) < cutoff) updates[code] = null;
    });
    if (Object.keys(updates).length) await db.ref("supportChats").update(updates);
  } catch (e) {}
}

/* ==========================================================
   TAB: الإعدادات (لغة / ثيم / لوجو / سجل مصاريف / أدوات إدارية)
   ========================================================== */
async function loadSettingsPanel() {
  const [adminSnap, studentSnap, waSnap] = await Promise.all([db.ref("settings/admin").get(), db.ref("settings/student").get(), db.ref("settings/systemConfig").get()]);
  const adminS = adminSnap.exists() ? adminSnap.val() : {};
  const studentS = studentSnap.exists() ? studentSnap.val() : {};
  const waS = waSnap.exists() ? waSnap.val() : {};
  document.getElementById("settingsAdminTopbar").value = adminS.topBarColor || "#3498db";
  document.getElementById("settingsAdminMode").value = adminS.mode || "light";
  document.getElementById("settingsStudentTopbar").value = studentS.topBarColor || "#3498db";
  document.getElementById("settingsStudentMode").value = studentS.mode || "light";
  document.getElementById("settingsAdminOpacity").value = adminS.bgOpacity != null ? adminS.bgOpacity : 85;
  document.getElementById("settingsAdminOpacityVal").textContent = document.getElementById("settingsAdminOpacity").value;
  document.getElementById("settingsStudentOpacity").value = studentS.bgOpacity != null ? studentS.bgOpacity : 85;
  document.getElementById("settingsStudentOpacityVal").textContent = document.getElementById("settingsStudentOpacity").value;
  document.getElementById("settingsDisableAutoPopup").checked = !!waS.disableAutoPopup;
  document.getElementById("settingsWebhookUrl").value = waS.webhookUrl || "";
  document.getElementById("settingsCardManagerName").value = waS.cardManagerName || "أ/ أحمد جمال عمر";
  document.getElementById("settingsCardAddress").value = waS.cardAddress || "سنتر العلا فى الجديدة";
  document.getElementById("settingsCardPhone1").value = waS.cardPhone1 || "01143229861";
  document.getElementById("settingsCardPhone2").value = waS.cardPhone2 || "01154782444";
  highlightLangButtons(adminS.lang || "ar");
}

document.getElementById("settingsAdminOpacity").addEventListener("input", (e) => {
  document.getElementById("settingsAdminOpacityVal").textContent = e.target.value;
});
document.getElementById("settingsStudentOpacity").addEventListener("input", (e) => {
  document.getElementById("settingsStudentOpacityVal").textContent = e.target.value;
});

document.getElementById("settingsSaveWaBtn").addEventListener("click", async () => {
  try {
    // استخدام update بدل set عشان مانمسحش صوت الإشعارات المحفوظ في نفس الـ node
    await db.ref("settings/systemConfig").update({
      disableAutoPopup: document.getElementById("settingsDisableAutoPopup").checked,
      webhookUrl: document.getElementById("settingsWebhookUrl").value.trim(),
    });
    showToast("تم حفظ إعدادات الواتساب", "success");
  } catch (err) { showToast("حدث خطأ: " + err.message, "error"); }
});

document.getElementById("settingsSaveCardInfoBtn").addEventListener("click", async () => {
  try {
    await db.ref("settings/systemConfig").update({
      cardManagerName: document.getElementById("settingsCardManagerName").value.trim(),
      cardAddress: document.getElementById("settingsCardAddress").value.trim(),
      cardPhone1: document.getElementById("settingsCardPhone1").value.trim(),
      cardPhone2: document.getElementById("settingsCardPhone2").value.trim(),
    });
    showToast("تم حفظ بيانات الكارت", "success");
  } catch (err) { showToast("حدث خطأ: " + err.message, "error"); }
});

document.getElementById("settingsNotifySound").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await fileToBase64(file);
    await db.ref("settings/systemConfig/notifySound").set(dataUrl);
    showToast("تم حفظ صوت الإشعارات بنجاح", "success");
    playNotifySound();
  } catch (err) { showToast("حدث خطأ أثناء رفع الصوت: " + err.message, "error"); }
});

document.getElementById("settingsTestSoundBtn").addEventListener("click", () => playNotifySound());

document.getElementById("settingsResetSoundBtn").addEventListener("click", async () => {
  await db.ref("settings/systemConfig/notifySound").remove();
  document.getElementById("settingsNotifySound").value = "";
  showToast("تم الرجوع لصوت التنبيه الافتراضي", "success");
});

function highlightLangButtons(lang) {
  document.getElementById("settingsLangAr").classList.toggle("btn-primary", lang !== "en");
  document.getElementById("settingsLangEn").classList.toggle("btn-primary", lang === "en");
}

document.getElementById("settingsLangAr").addEventListener("click", async () => {
  await db.ref("settings/admin/lang").set("ar");
  await loadAndApplyTheme("admin");
  highlightLangButtons("ar");
  showToast("تم التحويل للعربية", "success");
});
document.getElementById("settingsLangEn").addEventListener("click", async () => {
  await db.ref("settings/admin/lang").set("en");
  await loadAndApplyTheme("admin");
  highlightLangButtons("en");
  showToast("Switched interface direction to English", "success");
});

document.getElementById("settingsSaveAdminBtn").addEventListener("click", async () => {
  try {
    const updates = {
      topBarColor: document.getElementById("settingsAdminTopbar").value,
      mode: document.getElementById("settingsAdminMode").value,
      bgOpacity: Number(document.getElementById("settingsAdminOpacity").value),
    };
    const logoFile = document.getElementById("settingsAdminLogo").files[0];
    const bgFile = document.getElementById("settingsAdminBg").files[0];
    if (logoFile) updates.logo = await compressBase64(await fileToBase64(logoFile), 300, 0.85);
    if (bgFile) updates.background = await compressBase64(await fileToBase64(bgFile), 1280, 0.7);
    await db.ref("settings/admin").update(updates);
    showToast("تم حفظ ثيم لوحة الأدمن", "success");
    loadAndApplyTheme("admin");
  } catch (err) { showToast("حدث خطأ: " + err.message, "error"); }
});

document.getElementById("settingsSaveStudentBtn").addEventListener("click", async () => {
  try {
    const updates = {
      topBarColor: document.getElementById("settingsStudentTopbar").value,
      mode: document.getElementById("settingsStudentMode").value,
      bgOpacity: Number(document.getElementById("settingsStudentOpacity").value),
    };
    const logoFile = document.getElementById("settingsStudentLogo").files[0];
    const bgFile = document.getElementById("settingsStudentBg").files[0];
    if (logoFile) updates.logo = await compressBase64(await fileToBase64(logoFile), 300, 0.85);
    if (bgFile) updates.background = await compressBase64(await fileToBase64(bgFile), 1280, 0.7);
    await db.ref("settings/student").update(updates);
    showToast("تم حفظ ثيم صفحة الطالب (هيظهر للطلاب فور فتح الصفحة)", "success");
  } catch (err) { showToast("حدث خطأ: " + err.message, "error"); }
});

/* ---------- سجل المصاريف الإجمالي + الأرشفة الشهرية ---------- */
async function loadFinanceLedger() {
  const monthKey = currentMonthKey();
  document.getElementById("ledgerMonthLabel").textContent = monthLabel(monthKey);
  await archiveOldLedgerMonthIfNeeded(monthKey);

  attachFinanceRealtimeSync(); // بيرندر الجدول فوراً بالكاش الحالي لو موجود، وبيفضل محدّث تلقائياً بعد كده

  const archSnap = await db.ref("financeArchive").get();
  const sel = document.getElementById("ledgerArchiveSelect");
  sel.innerHTML = '<option value="">اختر شهر...</option>';
  if (archSnap.exists()) {
    Object.keys(archSnap.val()).sort().reverse().forEach((mk) => {
      sel.appendChild(el(`<option value="${mk}">${monthLabel(mk)}</option>`));
    });
  }
}

/* ==========================================================
   تحسين أداء: بدل ما "الإجمالي في الرئيسية" و"سجل المصاريف" كل واحدة تعمل
   اشتراك (listener) منفصل في students/paymentRequests وتقرا البيانات كاملة تاني
   من غير داعي في كل مرة، بقى فيه اشتراك واحد بس مشترك بين الاتنين، وبيستخدم
   البيانات اللي الـ listener بيوصله بالفعل بدل ما يعمل قراءة إضافية زيادة.
   ده بيقلل حمل قاعدة البيانات بشكل كبير خصوصاً مع زيادة عدد الطلاب.
   ========================================================== */
let financeListenersAttached = false;
let financeStudentsCache = {};
let financeRequestsCache = {};

function attachFinanceRealtimeSync() {
  if (financeListenersAttached) return;
  financeListenersAttached = true;
  db.ref("students").on("value", (snap) => {
    financeStudentsCache = snap.exists() ? snap.val() : {};
    refreshFinanceUI();
  });
  db.ref("paymentRequests").on("value", (snap) => {
    financeRequestsCache = snap.exists() ? snap.val() : {};
    refreshFinanceUI();
  });
}

/* بيحدث أي عنصر واجهة معروض حالياً (كارت الإجمالي في الرئيسية و/أو جدول سجل المصاريف)
   من غير أي قراءة إضافية من قاعدة البيانات - كل البيانات جاهزة في الكاش بالفعل */
function refreshFinanceUI() {
  const monthKey = currentMonthKey();
  const rows = computeLedgerRowsSync(financeStudentsCache, financeRequestsCache, monthKey);

  const totalBox = document.getElementById("ov_collectedTotal");
  if (totalBox) totalBox.textContent = rows.reduce((a, r) => a + r.amount, 0) + " ج";

  const ledgerTable = document.getElementById("ledgerTable");
  if (ledgerTable) renderLedgerTable(rows);
}

function computeLedgerRowsSync(students, paymentRequests, monthKey) {
  const rows = [];
  Object.values(students || {}).forEach((s) => {
    const payments = (s.payments || {})[monthKey] || {};
    // كل مادة/مدرس بتتحسب مرة واحدة بس في السجل (مش مرة لكل مجموعة مرتبطة بنفس المدرس)
    const billingGroups = getBillingGroups(s.subjects);
    billingGroups.forEach((g) => {
      if (!isBillingGroupPaid(g, payments)) return;
      rows.push({ student: s.name, subject: g.name, amount: parseFloat(g.fee) || 0, type: "عادي" });
    });
  });
  Object.values(paymentRequests || {}).forEach((r) => {
    if (r && r.status === "approved" && r.month === monthKey) {
      rows.push({ student: r.name, subject: r.subjectName || "-", amount: parseFloat(r.amount) || 0, type: "أونلاين" });
    }
  });
  return rows;
}

/* نسخة async بتقرا البيانات مباشرة من القاعدة (بدون الاعتماد على الكاش) - للاستخدام
   لمرة واحدة زي تقرير الـ PDF الشامل، مش listener دائم */
async function computeLedgerRows(monthKey) {
  const studentsSnap = await db.ref("students").get();
  const reqSnap = await db.ref("paymentRequests").get();
  return computeLedgerRowsSync(studentsSnap.exists() ? studentsSnap.val() : {}, reqSnap.exists() ? reqSnap.val() : {}, monthKey);
}

function renderLedgerTable(rows) {
  const tbody = document.querySelector("#ledgerTable tbody");
  const empty = document.getElementById("ledgerEmpty");
  tbody.innerHTML = "";
  const total = rows.reduce((a, r) => a + r.amount, 0);
  document.getElementById("ledgerTotal").textContent = total + " ج";
  if (!rows.length) { empty.classList.remove("hidden"); document.getElementById("ledgerTable").classList.add("hidden"); return; }
  empty.classList.add("hidden");
  document.getElementById("ledgerTable").classList.remove("hidden");
  rows.forEach((r) => tbody.appendChild(el(`<tr><td>${escapeHtml(r.student)}</td><td>${escapeHtml(r.subject)}</td><td>${r.amount} ج</td><td>${escapeHtml(r.type)}</td></tr>`)));
}

// بنهاية كل شهر: أرشفة الشهر اللي فات وبدء عد جديد من الصفر تلقائياً أول ما الأدمن يفتح الإعدادات في الشهر الجديد
async function archiveOldLedgerMonthIfNeeded(currentMonth) {
  const snap = await db.ref("settings/financeLedgerMonth").get();
  const storedMonth = snap.exists() ? snap.val() : currentMonth;
  if (storedMonth === currentMonth) {
    await db.ref("settings/financeLedgerMonth").set(currentMonth);
    return;
  }
  const oldRows = await computeLedgerRows(storedMonth);
  const total = oldRows.reduce((a, r) => a + r.amount, 0);
  await db.ref("financeArchive/" + storedMonth).set({ rows: oldRows, total, archivedAt: new Date().toISOString() });
  await db.ref("settings/financeLedgerMonth").set(currentMonth);
}

document.getElementById("ledgerArchiveSelect").addEventListener("change", async (e) => {
  const mk = e.target.value;
  const box = document.getElementById("ledgerArchiveResult");
  if (!mk) { box.innerHTML = ""; return; }
  const snap = await db.ref("financeArchive/" + mk).get();
  if (!snap.exists()) { box.innerHTML = '<p class="empty-box">لا يوجد أرشيف لهذا الشهر</p>'; return; }
  const data = snap.val();
  box.innerHTML = `<div class="panel" style="background:var(--bg);"><p style="font-weight:800; margin-bottom:8px;">إجمالي ${escapeHtml(monthLabel(mk))}: ${data.total} ج</p>` +
    (data.rows || []).map((r) => `<div class="pay-row"><div class="info"><b>${escapeHtml(r.student)}</b>${escapeHtml(r.subject)} - ${r.amount} ج (${escapeHtml(r.type)})</div></div>`).join("") + `</div>`;
});

/* ---------- أدوات إدارية حساسة ---------- */
document.getElementById("settingsGenTestBtn").addEventListener("click", async () => {
  const n = parseInt(document.getElementById("settingsTestCount").value, 10);
  if (!n || n < 1) return showToast("اكتب عدد صحيح أولاً", "error");
  if (n > 200) return showToast("الحد الأقصى 200 حساب في المرة الواحدة", "error");
  if (!confirm(`هيتم إنشاء ${n} حساب طالب وهمي للاختبار، متابعة؟`)) return;
  const sampleNames = ["أحمد", "محمد", "علي", "سارة", "منة", "ياسمين", "عمر", "كريم", "نور", "فريدة"];
  const btn = document.getElementById("settingsGenTestBtn");
  btn.disabled = true;
  try {
    for (let i = 0; i < n; i++) {
      const code = await generateUniqueStudentId();
      const name = sampleNames[Math.floor(Math.random() * sampleNames.length)] + " (تجريبي " + code + ")";
      await db.ref("students/" + code).set({
        code, name, grade: "صف تجريبي", parentPhone: "0100000" + code,
        studentNumber: "", address: "حساب تجريبي", subjects: {}, grades: {}, attendance: {}, notes: {}, payments: {},
        createdAt: new Date().toISOString(), isTestAccount: true,
      });
    }
    showToast(`تم إنشاء ${n} حساب تجريبي بنجاح`, "success");
    document.getElementById("settingsTestCount").value = "";
    loadOverview();
  } catch (err) {
    showToast("حدث خطأ: " + err.message, "error");
  } finally { btn.disabled = false; }
});

document.getElementById("settingsDeleteAllBtn").addEventListener("click", () => {
  document.getElementById("factoryResetConfirmInput").value = "";
  document.getElementById("factoryResetConfirmBtn").disabled = true;
  document.getElementById("factoryResetModal").classList.remove("hidden");
});
document.getElementById("closeFactoryResetModal").addEventListener("click", () => {
  document.getElementById("factoryResetModal").classList.add("hidden");
});
document.getElementById("factoryResetConfirmInput").addEventListener("input", (e) => {
  document.getElementById("factoryResetConfirmBtn").disabled = e.target.value.trim() !== "حذف";
});
document.getElementById("factoryResetConfirmBtn").addEventListener("click", async () => {
  const btn = document.getElementById("factoryResetConfirmBtn");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.innerHTML = '<span class="spin"></span> جاري الحذف الشامل...';
  try {
    // حذف شامل لكل بيانات النظام (مش بس الطلاب) عشان الموقع يرجع لحالته الأولى تماماً
    await Promise.all([
      db.ref("students").remove(),
      db.ref("teachers").remove(),
      db.ref("absentees").remove(),
      db.ref("paymentRequests").remove(),
      db.ref("financeArchive").remove(),
      db.ref("supportChats").remove(),
      db.ref("stats").remove(),
      db.ref("presence").remove(),
      db.ref("systemBackups").remove(),
    ]);
    showToast("تم حذف كل بيانات النظام - الموقع رجع لحالته الأولى", "success");
    document.getElementById("factoryResetModal").classList.add("hidden");
    studentsCache = {};
    absenteesCache = {};
    loadOverview();
  } catch (err) {
    showToast("حدث خطأ أثناء الحذف: " + err.message, "error");
  } finally {
    btn.textContent = originalText;
  }
});

document.getElementById("settingsOpenDeleteOneBtn").addEventListener("click", async () => {
  const snap = await db.ref("students").get();
  studentsCache = snap.exists() ? snap.val() : {};
  renderDeleteOneList(studentsCache);
  document.getElementById("deleteOneModal").classList.remove("hidden");
});
document.getElementById("closeDeleteOneModal").addEventListener("click", () => document.getElementById("deleteOneModal").classList.add("hidden"));
document.getElementById("deleteOneSearch").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = Object.fromEntries(
    Object.entries(studentsCache).filter(
      ([code, s]) => code.includes(q) || (s.name || "").toLowerCase().includes(q) || (s.studentNumber || "").toLowerCase().includes(q)
    )
  );
  renderDeleteOneList(filtered);
});

function renderDeleteOneList(students) {
  const wrap = document.getElementById("deleteOneList");
  const entries = Object.entries(students);
  if (!entries.length) { wrap.innerHTML = '<p class="empty-box">لا يوجد طلاب</p>'; return; }
  wrap.innerHTML = "";
  entries.forEach(([code, s]) => {
    const row = el(`<div class="student-list-row"><span class="name">${escapeHtml(s.name)}${s.studentNumber ? " - رقم: " + escapeHtml(s.studentNumber) : ""}</span><span class="code">${escapeHtml(code)}</span></div>`);
    const delBtn = el('<button class="btn btn-danger" style="margin-right:8px;">حذف</button>');
    row.appendChild(delBtn);
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`تأكيد حذف الطالب ${s.name}؟`)) return;
      await db.ref("students/" + code).remove();
      showToast("تم حذف الطالب", "success");
      delete studentsCache[code];
      renderDeleteOneList(studentsCache);
      loadOverview();
    });
    wrap.appendChild(row);
  });
}
