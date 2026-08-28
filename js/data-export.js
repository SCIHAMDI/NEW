/* ==========================================================
   إدارة البيانات والتصدير - js/data-export.js
   ==========================================================
   1) تصدير تقرير شامل بكل البيانات كـ PDF (عن طريق طباعة المتصفح، مش jsPDF)
      - جافاسكريبت مكتبات زي jsPDF مفيهاش دعم حقيقي للغة العربية (مفيش ربط/تشكيل
        للحروف - "Arabic shaping" - غير لو تم تضمين خط عربي خاص يدوياً بشكل معقد)،
        فالنص العربي هيطلع متقطع أو مقلوب. الحل الأضمن 100% هو نفس الأسلوب المستخدم
        في طباعة كارت الطالب: بناء تقرير HTML منسق زي ما إنت شايفه في الصفحة بالظبط،
        وبعدين استخدام "طباعة المتصفح" (Ctrl+P) واختيار "Save as PDF" - كده النص
        العربي هيطلع سليم 100% لأنه نفس الخط والعرض اللي المتصفح بيرسمه أصلاً.
   2) تصدير نسخة احتياطية كاملة (JSON) لكل عقد قاعدة البيانات المعروفة في التطبيق.
   3) استعادة نسخة احتياطية (Import JSON) مع نافذة تأكيد قبل الاستبدال.
   ========================================================== */

// كل العقد (nodes) الرئيسية المستخدمة فعلياً في التطبيق - المصدر الوحيد للحقيقة
// لأي عملية نسخ احتياطي/استعادة/تصدير شامل، عشان نضمن إننا مانسناش أي جزء من البيانات
const ALL_DB_NODES = ["students", "teachers", "absentees", "paymentRequests", "financeArchive", "supportChats", "stats", "settings", "presence"];

/* جلب كل بيانات النظام من كل العقد المعروفة دفعة واحدة */
async function fetchAllData() {
  const snapshots = await Promise.all(ALL_DB_NODES.map((node) => db.ref(node).get()));
  const data = {};
  ALL_DB_NODES.forEach((node, i) => {
    data[node] = snapshots[i].exists() ? snapshots[i].val() : null;
  });
  return data;
}

/* ==========================================================
   تصدير نسخة احتياطية كاملة (JSON)
   ========================================================== */
const MAX_SAVED_BACKUPS = 5; // أقصى عدد نسخ احتياطية بتتحفظ جوه النظام نفسه - الأقدم بيتم حذفه تلقائياً

async function exportJsonBackup() {
  const btn = document.getElementById("exportJsonBackupBtn");
  const original = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> جاري تجهيز النسخة الاحتياطية...';
  try {
    const data = await fetchAllData();
    const payload = {
      exportedAt: new Date().toISOString(),
      appName: "Al Ola Center",
      schemaVersion: 1,
      data,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `al-ola-center-backup-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    // بالإضافة للتنزيل، بنحفظ نسخة جوه النظام نفسه (systemBackups) عشان تقدر تسترجعها
    // بضغطة واحدة من غير ما تحتاج تدور على الملف اللي نزّلته على جهازك
    await saveBackupToSystem(payload);

    showToast("تم تصدير النسخة الاحتياطية بنجاح (وتم حفظ نسخة داخل النظام كمان)", "success");
  } catch (err) {
    console.error(err);
    showToast("حدث خطأ أثناء تصدير النسخة الاحتياطية: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* حفظ نسخة احتياطية جوه قاعدة البيانات نفسها (systemBackups/{timestamp})، مع الاحتفاظ
   بآخر MAX_SAVED_BACKUPS نسخ بس وحذف الأقدم تلقائياً عشان الحجم ميكبرش من غير داعي */
async function saveBackupToSystem(payload) {
  const id = String(Date.now());
  await db.ref("systemBackups/" + id).set(payload);

  const snap = await db.ref("systemBackups").get();
  if (!snap.exists()) return;
  const ids = Object.keys(snap.val()).sort(); // الأقدم أولاً (المفاتيح أرقام زمنية)
  const excess = ids.length - MAX_SAVED_BACKUPS;
  if (excess > 0) {
    const updates = {};
    ids.slice(0, excess).forEach((oldId) => (updates[oldId] = null));
    await db.ref("systemBackups").update(updates);
  }
  loadSavedBackupsList();
}

/* عرض قائمة النسخ الاحتياطية المحفوظة جوه النظام */
async function loadSavedBackupsList() {
  const wrap = document.getElementById("savedBackupsList");
  const empty = document.getElementById("savedBackupsEmpty");
  try {
    const snap = await db.ref("systemBackups").get();
    const backups = snap.exists() ? snap.val() : {};
    const ids = Object.keys(backups).sort().reverse(); // الأحدث أولاً
    wrap.innerHTML = "";
    if (!ids.length) { empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");

    ids.forEach((id) => {
      const b = backups[id];
      const nodesCount = b && b.data ? Object.values(b.data).filter((v) => v !== null).length : 0;
      const row = el(`
        <div class="pay-row">
          <div class="info"><b>${escapeHtmlSafe(formatDateArabic(b.exportedAt))} - ${escapeHtmlSafe(formatTimeArabic(b.exportedAt))}</b>${nodesCount} قسم بيانات محفوظ</div>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-outline" data-restore>♻️ استرجاع</button>
            <button class="btn btn-outline" data-delete title="حذف هذه النسخة">🗑️</button>
          </div>
        </div>`);
      row.querySelector("[data-restore]").addEventListener("click", () => openImportConfirm(b.data, `النسخة المحفوظة بتاريخ ${formatDateArabic(b.exportedAt)} - ${formatTimeArabic(b.exportedAt)}`));
      row.querySelector("[data-delete]").addEventListener("click", async () => {
        if (!confirm("حذف هذه النسخة الاحتياطية المحفوظة نهائياً؟ (الملف اللي نزّلته على جهازك مش هيتأثر)")) return;
        await db.ref("systemBackups/" + id).remove();
        loadSavedBackupsList();
      });
      wrap.appendChild(row);
    });
  } catch (err) {
    console.error("فشل تحميل النسخ الاحتياطية المحفوظة:", err);
  }
}

/* ==========================================================
   استعادة نسخة احتياطية (Import JSON) - من ملف مرفوع أو من نسخة محفوظة جوه النظام
   ========================================================== */
let pendingImportData = null;

/* نقطة دخول موحّدة لأي مصدر بيانات استعادة (ملف مرفوع أو نسخة محفوظة) - بتوري نافذة التأكيد */
function openImportConfirm(data, sourceLabel) {
  const foundNodes = ALL_DB_NODES.filter((node) => data && Object.prototype.hasOwnProperty.call(data, node));
  if (!foundNodes.length) {
    showToast("النسخة دي مش صالحة أو فاضية", "error");
    return;
  }
  pendingImportData = data;
  const list = document.getElementById("importBackupSectionsList");
  const sourceNote = sourceLabel ? `<li style="color:var(--purple-dark); font-weight:800; list-style:none; margin-bottom:6px;">📦 المصدر: ${escapeHtmlSafe(sourceLabel)}</li>` : "";
  list.innerHTML = sourceNote + foundNodes.map((n) => `<li>${escapeHtmlSafe(n)}</li>`).join("");
  document.getElementById("importBackupConfirmInput").value = "";
  document.getElementById("importBackupConfirmBtn").disabled = true;
  document.getElementById("importBackupModal").classList.remove("hidden");
}

document.getElementById("importJsonBackupInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    // بيدعم الشكل الجديد { data: {...} } وكمان لو حد رفع ملف بالعقد مباشرة من غير wrapper
    const data = parsed && parsed.data ? parsed.data : parsed;
    openImportConfirm(data, file.name);
  } catch (err) {
    showToast("تعذر قراءة الملف - تأكد إنه ملف JSON صالح", "error");
  } finally {
    e.target.value = ""; // يسمح باختيار نفس الملف تاني لو احتاج يعيد المحاولة
  }
});

document.getElementById("closeImportBackupModal").addEventListener("click", () => {
  document.getElementById("importBackupModal").classList.add("hidden");
  pendingImportData = null;
});

document.getElementById("importBackupConfirmInput").addEventListener("input", (e) => {
  document.getElementById("importBackupConfirmBtn").disabled = e.target.value.trim() !== "استعادة";
});

document.getElementById("importBackupConfirmBtn").addEventListener("click", async () => {
  if (!pendingImportData) return;
  const btn = document.getElementById("importBackupConfirmBtn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.innerHTML = '<span class="spin"></span> جاري الاستعادة...';
  try {
    const writes = ALL_DB_NODES
      .filter((node) => Object.prototype.hasOwnProperty.call(pendingImportData, node))
      .map((node) => db.ref(node).set(pendingImportData[node]));
    await Promise.all(writes);
    showToast("تم استعادة النسخة الاحتياطية بنجاح", "success");
    document.getElementById("importBackupModal").classList.add("hidden");
    pendingImportData = null;
    studentsCache = {};
    loadOverview();
  } catch (err) {
    console.error(err);
    showToast("حدث خطأ أثناء الاستعادة: " + err.message, "error");
  } finally {
    btn.textContent = original;
  }
});

/* ==========================================================
   تصدير تقرير شامل (PDF عبر طباعة المتصفح)
   ========================================================== */
function escapeHtmlSafe(v) {
  return typeof escapeHtml === "function" ? escapeHtml(v) : String(v ?? "");
}

function reportTable(headers, rows) {
  if (!rows.length) return '<p class="r-empty">لا توجد بيانات</p>';
  return `<table>
    <thead><tr>${headers.map((h) => `<th>${escapeHtmlSafe(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtmlSafe(c)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
}

function buildFullReportHtml(data) {
  const students = data.students || {};
  const teachers = data.teachers || {};
  const absentees = data.absentees || {};
  const paymentRequests = data.paymentRequests || {};
  const supportChats = data.supportChats || {};
  const stats = data.stats || {};
  const settings = data.settings || {};

  const studentEntries = Object.entries(students);
  const monthKey = currentMonthKey();

  // ---------- ملخص عام ----------
  let totalCollected = 0;
  let paidStudents = 0;
  studentEntries.forEach(([, s]) => {
    const groups = getBillingGroups(s.subjects);
    const payments = (s.payments || {})[monthKey] || {};
    const isFullyPaid = groups.length > 0 && groups.every((g) => isBillingGroupPaid(g, payments));
    if (isFullyPaid) paidStudents++;
    groups.forEach((g) => { if (isBillingGroupPaid(g, payments)) totalCollected += parseFloat(g.fee) || 0; });
  });

  const summaryHtml = `
    <div class="r-section">
      <h2>📊 ملخص عام</h2>
      <div class="r-stats">
        <div class="r-stat"><b>${studentEntries.length}</b>إجمالي عدد الطلاب</div>
        <div class="r-stat"><b>${Object.keys(teachers).length}</b>عدد المدرسين</div>
        <div class="r-stat"><b>${totalCollected}</b>إجمالي المحصّل هذا الشهر (ج)</div>
        <div class="r-stat"><b>${paidStudents} / ${studentEntries.length}</b>دفعوا بالكامل هذا الشهر</div>
        <div class="r-stat"><b>${Object.keys(absentees[todayKey()] || {}).length}</b>غائبين اليوم</div>
        <div class="r-stat"><b>${Object.values(paymentRequests).filter((r) => r && r.status === "pending").length}</b>طلبات دفع أونلاين معلقة</div>
        <div class="r-stat"><b>${stats.pageViews || 0}</b>إجمالي عدد مرات فتح الموقع</div>
      </div>
    </div>`;

  // ---------- قائمة الطلاب ----------
  const studentsRows = studentEntries.map(([code, s]) => [
    code, s.name || "-", s.grade || "-", s.parentPhone || "-",
    Object.keys(s.subjects || {}).length, s.studentNumber || "-",
  ]);
  const studentsHtml = `
    <div class="r-section">
      <h2>👥 قائمة الطلاب (${studentEntries.length})</h2>
      ${reportTable(["الكود", "الاسم", "الصف", "رقم ولي الأمر", "عدد المواد", "رقم الطالب"], studentsRows)}
    </div>`;

  // ---------- المدرسين والمجموعات ----------
  const teacherRows = [];
  Object.values(teachers).forEach((t) => {
    const groups = t.groups || {};
    if (!Object.keys(groups).length) { teacherRows.push([t.name, "-", "-", "-", "-"]); return; }
    Object.values(groups).forEach((g) => {
      teacherRows.push([t.name, g.label || "-", parseDaysCsv(g.day).join("، ") || "-", g.time || "-", g.fee || "-"]);
    });
  });
  const teachersHtml = `
    <div class="r-section">
      <h2>🧑‍🏫 المدرسين والمجموعات (${Object.keys(teachers).length})</h2>
      ${reportTable(["اسم المدرس", "المجموعة", "الأيام", "الميعاد", "المصاريف"], teacherRows)}
    </div>`;

  // ---------- المصروفات (سجل الشهر الحالي) ----------
  const expenseRows = [];
  studentEntries.forEach(([, s]) => {
    const groups = getBillingGroups(s.subjects);
    const payments = (s.payments || {})[monthKey] || {};
    groups.forEach((g) => {
      if (isBillingGroupPaid(g, payments)) expenseRows.push([s.name, g.name, (parseFloat(g.fee) || 0) + " ج", "عادي"]);
    });
  });
  Object.values(paymentRequests).forEach((r) => {
    if (r && r.status === "approved" && r.month === monthKey) expenseRows.push([r.name, r.subjectName || "-", (parseFloat(r.amount) || 0) + " ج", "أونلاين"]);
  });
  const expensesHtml = `
    <div class="r-section">
      <h2>💰 سجل المصاريف - شهر ${monthLabel(monthKey)} (إجمالي ${totalCollected} ج)</h2>
      ${reportTable(["الطالب", "المادة", "المبلغ", "النوع"], expenseRows)}
    </div>`;

  // ---------- طلبات الدفع الأونلاين المعلقة ----------
  const pendingReqRows = Object.values(paymentRequests)
    .filter((r) => r && r.status === "pending")
    .map((r) => [r.name, r.code, r.subjectName || "-", (r.amount || 0) + " ج", r.phone || "-"]);
  const requestsHtml = `
    <div class="r-section">
      <h2>📋 طلبات الدفع الأونلاين المعلقة (${pendingReqRows.length})</h2>
      ${reportTable(["الطالب", "الكود", "المادة", "المبلغ", "رقم التحويل"], pendingReqRows)}
    </div>`;

  // ---------- حضور اليوم ----------
  const today = todayKey();
  const attendanceRows = [];
  studentEntries.forEach(([code, s]) => {
    Object.values(s.attendance || {}).forEach((a) => {
      if (a.date === today) attendanceRows.push([s.name, code, a.type === "in" ? "حضور" : "انصراف", a.time || "-"]);
    });
  });
  const attendanceHtml = `
    <div class="r-section">
      <h2>📅 حضور وانصراف اليوم (${today})</h2>
      ${reportTable(["الطالب", "الكود", "النوع", "الوقت"], attendanceRows)}
      <p style="font-size:10.5px; color:#999; margin-top:4px;">* السجل الكامل لكل تاريخ الحضور مضمّن بالكامل في النسخة الاحتياطية (JSON) لكل طالب.</p>
    </div>`;

  // ---------- الغائبين اليوم ----------
  const todayAbsentees = Object.entries(absentees[today] || {}).map(([code, a]) => [a.name, code, a.time || "-", a.status === "sent" ? "تم الإرسال" : "لم يُرسل"]);
  const absenteesHtml = `
    <div class="r-section">
      <h2>🚫 الغائبين اليوم (${todayAbsentees.length})</h2>
      ${reportTable(["الطالب", "الكود", "المعاد", "حالة التنبيه"], todayAbsentees)}
    </div>`;

  // ---------- إعدادات النظام ----------
  const sysConfig = settings.systemConfig || {};
  const settingsHtml = `
    <div class="r-section">
      <h2>⚙️ إعدادات النظام</h2>
      ${reportTable(["الإعداد", "القيمة"], [
        ["اسم الإدارة (على الكارت)", sysConfig.cardManagerName || "-"],
        ["رقم التواصل 1", sysConfig.cardPhone1 || "-"],
        ["رقم التواصل 2", sysConfig.cardPhone2 || "-"],
        ["العنوان", sysConfig.cardAddress || "-"],
        ["منع فتح واتساب تلقائياً", sysConfig.disableAutoPopup ? "مفعّل" : "غير مفعّل"],
        ["استفسارات لم يتم الرد عليها", Object.values(supportChats).filter((c) => {
          const msgs = Object.values(c.messages || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
          const last = msgs[msgs.length - 1];
          return last && last.from === "student";
        }).length],
      ])}
    </div>`;

  const now = new Date();
  return `
    <div class="r-header">
      <h1>تقرير شامل - Al Ola Center</h1>
      <p>تم إنشاء التقرير في: ${formatDateArabic(now)} - ${formatTimeArabic(now)}</p>
    </div>
    ${summaryHtml}
    ${studentsHtml}
    ${teachersHtml}
    ${expensesHtml}
    ${requestsHtml}
    ${attendanceHtml}
    ${absenteesHtml}
    ${settingsHtml}
  `;
}

document.getElementById("exportPdfReportBtn").addEventListener("click", async () => {
  const btn = document.getElementById("exportPdfReportBtn");
  const original = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> جاري تجهيز التقرير...';
  try {
    const data = await fetchAllData();
    document.getElementById("fullReportPrintArea").innerHTML = buildFullReportHtml(data);
    document.getElementById("fullReportModal").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    showToast("حدث خطأ أثناء تجهيز التقرير: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

document.getElementById("closeFullReportModal").addEventListener("click", () => {
  document.getElementById("fullReportModal").classList.add("hidden");
});

document.getElementById("printFullReportBtn").addEventListener("click", () => {
  printWithPageSize("print-full-report", "A4", "12mm");
});

document.getElementById("exportJsonBackupBtn").addEventListener("click", exportJsonBackup);

/* ==========================================================
   أداة مشتركة: طباعة عنصر معين بمقاس صفحة محدد بدون ما يأثر على باقي أنواع الطباعة
   (كارت الطالب بمقاس صغير، التقرير الشامل بمقاس A4) - بيحقن @page ديناميكياً
   ========================================================== */
function printWithPageSize(bodyClass, pageSize, pageMargin) {
  const styleId = "dynamicPrintPageSize";
  let styleEl = document.getElementById(styleId);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `@page{ size:${pageSize}; margin:${pageMargin}; }`;
  document.body.classList.add(bodyClass);

  const cleanup = () => {
    document.body.classList.remove(bodyClass);
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // احتياطي لو المتصفح ما دعمش afterprint صح
  setTimeout(cleanup, 3000);
}
