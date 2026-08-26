/* ==========================================================
   صفحة بروفايل الطالب - عرض عام (بدون تسجيل دخول)
   الوصول: student.html?id=CODE
   ========================================================== */

/* --- دوال مساعدة لتجنب أخطاء ReferenceError ---
   ملحوظة: trackPresence و trackPageView الحقيقيتين موجودتين في utils.js وبيتم تحميله قبل هذا الملف،
   فمفيش داعي لتعريفهم هنا تاني (كانوا معرّفين بشكل وهمي هنا قبل كده وده كان بيمنع عداد "متصلين الآن"
   وعداد "مرات فتح الموقع" من الشغل فعلياً - تم حذف التعريف الوهمي وترك الأصلي من utils.js يشتغل). */

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyArabic(d) {
  const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  return months[d.getMonth()];
}

function formatDateArabic(dateStr) {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    return `${d.getDate()} ${monthKeyArabic(d)} ${d.getFullYear()}`;
  } catch (e) {
    return dateStr;
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

function compressBase64(base64Str, maxWidth = 600, quality = 0.6) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
  });
}

function showToast(msg, type = "info") {
  alert(msg);
}
// --------------------------------------------------------

const params = new URLSearchParams(window.location.search);
const studentCode = params.get("id");

const tabs = document.querySelectorAll(".tab-item");
const panels = document.querySelectorAll(".tab-panel");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    panels.forEach((p) => p.classList.add("hidden"));
    document.getElementById("tab-" + tab.dataset.tab).classList.remove("hidden");
  });
});

document.getElementById("enableNotifBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) return showToast("المتصفح لا يدعم الإشعارات", "error");
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    document.getElementById("noticeBanner").style.display = "none";
    showToast("تم تفعيل الإشعارات", "success");
  }
});

trackPresence("student");
trackPageView();
if (typeof loadAndApplyTheme === "function") loadAndApplyTheme("student");

let currentStudent = null;
let currentCode = null;

if (!studentCode) {
  document.getElementById("loadingBox").classList.add("hidden");
  document.getElementById("notFoundBox").classList.remove("hidden");
} else {
  loadStudent(studentCode);
}

async function loadStudent(code) {
  try {
    const snap = await db.ref("students/" + code).get();
    if (!snap.exists()) {
      document.getElementById("loadingBox").classList.add("hidden");
      document.getElementById("notFoundBox").classList.remove("hidden");
      return;
    }
    const student = snap.val();
    currentStudent = student;
    currentCode = code;
    renderAll(student, code);
    document.getElementById("loadingBox").classList.add("hidden");
    document.getElementById("pageContent").classList.remove("hidden");
    document.getElementById("footerNote").classList.remove("hidden");
    document.getElementById("tab-profile").classList.add("hidden"); // default tab = analysis (matches active button)
  } catch (err) {
    console.error(err);
    document.getElementById("loadingBox").textContent = "حدث خطأ أثناء تحميل البيانات.";
  }
}

function renderAll(student, code) {
  const subjects = Object.values(student.subjects || {});
  const grades = Object.values(student.grades || {});
  const attendance = Object.values(student.attendance || {});

  // ---------- Sidebar ----------
  document.getElementById("s_name").textContent = student.name || "-";
  document.getElementById("s_code").textContent = "كود الطالب: " + code;
  document.getElementById("s_grade").textContent = "الصف: " + (student.grade || "-");
  const groupsHtml = subjects.length
    ? subjects.map((s, i) => `${i + 1}. <strong>${escapeHtml(s.name)}</strong>${s.day ? " - " + escapeHtml(parseDaysCsv(s.day).join("، ")) : ""}${s.time ? " - " + escapeHtml(s.time) : ""}`).join("<br>")
    : "لا توجد مجموعات مسجلة";
  document.getElementById("s_groups").innerHTML = groupsHtml;

  const link = SITE_BASE_URL + "student.html?id=" + code;
  new QRCode(document.getElementById("s_qr"), { text: link, width: 150, height: 150 });

  // ---------- Profile tab ----------
  document.getElementById("p_name").textContent = student.name || "-";
  document.getElementById("p_code").textContent = code;
  document.getElementById("p_createdAt").textContent = student.createdAt ? formatDateArabic(student.createdAt) : "-";
  const pStudentNumberEl = document.getElementById("p_studentNumber");
  if (pStudentNumberEl) pStudentNumberEl.textContent = student.studentNumber || "غير محدد";
  document.getElementById("p_groups").innerHTML = groupsHtml || "-";
  document.getElementById("p_address").textContent = student.address || "غير محدد";
  document.getElementById("p_dob").textContent = student.dob || "غير محدد";
  document.getElementById("p_grade").textContent = student.grade || "-";

  // ---------- Attendance stats ----------
  const presentDatesSet = new Set(attendance.filter((a) => a.type === "in").map((a) => a.date));
  const presentCount = presentDatesSet.size;
  // بدون نظام غياب يدوي منفصل، الغياب هنا = صفر افتراضياً (يمكن ربطه بجدول أيام الحصص لاحقاً)
  const absentCount = student.absences ? Object.keys(student.absences).length : 0;
  const totalDays = presentCount + absentCount;
  const attendanceRate = totalDays > 0 ? (presentCount / totalDays) * 100 : 0;

  document.getElementById("att_avg").textContent = attendanceRate.toFixed(1) + "%";
  document.getElementById("att_absent").textContent = absentCount;
  document.getElementById("att_present").textContent = presentCount;

  // Attendance pie chart
  new Chart(document.getElementById("attPieChart"), {
    type: "pie",
    data: {
      labels: [`حاضر (${presentCount})`, `غائب (${absentCount})`],
      datasets: [{ data: [presentCount, absentCount], backgroundColor: ["#4ECDC4", "#F2884B"], borderWidth: 0 }],
    },
    options: { plugins: { legend: { position: "bottom", labels: { font: { family: "Cairo" } } } } },
  });

  // Attendance list
  const attList = document.getElementById("att_list");
  const attEmpty = document.getElementById("att_empty");
  const sortedAtt = [...attendance].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 15);
  if (!sortedAtt.length) {
    attEmpty.classList.remove("hidden");
  } else {
    attList.innerHTML = sortedAtt
      .map(
        (a) => `
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg); border-radius:10px; padding:10px 14px; margin-bottom:8px;">
        <span class="badge ${a.type === "in" ? "success" : "pending"}">${a.type === "in" ? "حاضر" : "انصراف"}</span>
        <span style="font-size:12.5px; color:var(--text-mid); font-weight:600;">${escapeHtml(a.date)} - ${escapeHtml(a.time || "")}</span>
      </div>`
      )
      .join("");
  }

  // ---------- Grades stats ----------
  const percentages = grades.map((g) => (g.maxScore ? (g.score / g.maxScore) * 100 : 0));
  const avgGrade = percentages.length
    ? percentages.reduce((a, b) => a + b, 0) / percentages.length
    : 0;
  const maxGrade = percentages.length ? Math.max(...percentages) : 0;
  const minGrade = percentages.length ? Math.min(...percentages) : 0;

  document.getElementById("exam_avg").textContent = avgGrade.toFixed(1) + "%";
  document.getElementById("exam_max").textContent = maxGrade.toFixed(1) + "%";
  document.getElementById("exam_min").textContent = minGrade.toFixed(1) + "%";
  document.getElementById("exam_count").textContent = grades.length;

  const last7 = [...grades].sort((a, b) => (a.date > b.date ? 1 : -1)).slice(-7);
  new Chart(document.getElementById("examChart"), {
    type: "bar",
    data: {
      labels: last7.map((g) => g.examName || g.date),
      datasets: [{ label: "الدرجة %", data: last7.map((g) => (g.maxScore ? (g.score / g.maxScore) * 100 : 0)), backgroundColor: "#6C5DD3", borderRadius: 6 }],
    },
    options: { scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { labels: { font: { family: "Cairo" } } } } },
  });

  const examList = document.getElementById("exam_list");
  const examEmpty = document.getElementById("exam_empty");
  if (!grades.length) {
    examEmpty.classList.remove("hidden");
  } else {
    examList.innerHTML = [...grades]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map(
        (g) => `
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg); border-radius:10px; padding:10px 14px; margin-bottom:8px;">
        <div>
          <div style="font-weight:700; font-size:13.5px;">${escapeHtml(g.examName)}</div>
          <div style="font-size:11.5px; color:var(--text-light);">${escapeHtml(g.date || "")}</div>
        </div>
        <div style="font-weight:800; color:var(--purple-dark);">${g.score} / ${g.maxScore}</div>
      </div>`
      )
      .join("");
  }

  // ---------- Analysis tab ----------
  const performance = (attendanceRate + avgGrade) / 2;
  document.getElementById("an_performance").textContent = performance.toFixed(1) + "%";
  document.getElementById("an_attendance").textContent = attendanceRate.toFixed(1) + "%";
  document.getElementById("an_grades").textContent = avgGrade.toFixed(1) + "%";

  // Monthly attendance chart (last 6 months)
  const months = lastNMonths(6);
  const monthlyAttData = months.map((m) => {
    const daysInMonth = attendance.filter((a) => a.type === "in" && a.date && a.date.startsWith(m.key));
    const uniqueDays = new Set(daysInMonth.map((a) => a.date));
    return uniqueDays.size;
  });
  new Chart(document.getElementById("monthlyAttChart"), {
    type: "bar",
    data: { labels: months.map((m) => m.label), datasets: [{ label: "أيام الحضور", data: monthlyAttData, backgroundColor: "#6C5DD3", borderRadius: 6 }] },
    options: { scales: { y: { beginAtZero: true } }, plugins: { legend: { labels: { font: { family: "Cairo" } } } } },
  });

  // Monthly grades chart
  const monthlyGradeData = months.map((m) => {
    const monthGrades = grades.filter((g) => g.date && g.date.startsWith(m.key));
    if (!monthGrades.length) return 0;
    const pct = monthGrades.map((g) => (g.maxScore ? (g.score / g.maxScore) * 100 : 0));
    return pct.reduce((a, b) => a + b, 0) / pct.length;
  });
  new Chart(document.getElementById("monthlyGradeChart"), {
    type: "line",
    data: {
      labels: months.map((m) => m.label),
      datasets: [{ label: "متوسط الدرجات %", data: monthlyGradeData, borderColor: "#4ECDC4", backgroundColor: "rgba(78,205,196,0.15)", fill: true, tension: 0.35 }],
    },
    options: { scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { labels: { font: { family: "Cairo" } } } } },
  });

  // ---------- Daily tab ----------
  const today = todayKey();
  const attendedToday = attendance.some((a) => a.type === "in" && a.date === today);
  document.getElementById("d_level").textContent = avgGrade.toFixed(1) + "%";
  document.getElementById("d_att").textContent = attendanceRate.toFixed(1) + "%";
  document.getElementById("d_today").textContent = attendedToday ? "✔" : "✕";

  // ---------- Expenses tab ----------
  const monthKey = currentMonthKey();
  const monthPayments = (student.payments || {})[monthKey] || {};
  const subjectEntries = Object.entries(student.subjects || {});
  const totalFees = subjectEntries.reduce((sum, [, s]) => sum + Number(s.fee || 0), 0);
  const paidCount = subjectEntries.filter(([key]) => monthPayments[key]).length;

  document.getElementById("ex_total").textContent = totalFees + " ج";
  document.getElementById("ex_paidCount").textContent = paidCount + " / " + subjectEntries.length;
  document.getElementById("ex_subjectsCount").textContent = subjectEntries.length;

  const statusWrap = document.getElementById("ex_subjectsStatus");
  if (!subjectEntries.length) {
    statusWrap.innerHTML = '<p class="empty-box">لا توجد مواد مسجلة</p>';
  } else {
    statusWrap.innerHTML = subjectEntries
      .map(([key, s]) => {
        const isPaid = !!monthPayments[key];
        return `<div class="pay-row"><div class="info"><b>${escapeHtml(s.name)}</b>${escapeHtml(s.fee || 0)} جنيه</div><span class="badge ${isPaid ? "success" : "danger"}">${isPaid ? "مدفوع ✓" : "غير مدفوع ✗"}</span></div>`;
      })
      .join("");
  }

  // ---------- Notes tab ----------
  const notes = Object.values(student.notes || {}).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const notesList = document.getElementById("notes_list");
  const notesEmpty = document.getElementById("notes_empty");
  if (!notes.length) {
    notesEmpty.classList.remove("hidden");
  } else {
    notesEmpty.classList.add("hidden");
    notesList.innerHTML = notes.map((n) => `<div class="note-card"><div class="txt">${escapeHtml(n.text)}</div><div class="meta">${escapeHtml(formatDateArabic(n.createdAt))}</div></div>`).join("");
  }

  // تحديث "ملاحظات اليوم" في تبويب اليومي
  const todayNotes = notes.filter((n) => (n.createdAt || "").startsWith(today));
  const dailyNotesBox = document.getElementById("daily_notes");
  if (todayNotes.length) {
    dailyNotesBox.className = "";
    dailyNotesBox.innerHTML = todayNotes.map((n) => `<div class="note-card">${escapeHtml(n.text)}</div>`).join("");
  }

  // ---------- Payment modal setup ----------
  setupPayModal(student, code, subjectEntries);
}

function setupPayModal(student, code, subjectEntries) {
  const select = document.getElementById("pf_subject");
  select.innerHTML = subjectEntries.map(([key, s]) => `<option value="${key}" data-fee="${s.fee || 0}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)} (${s.fee || 0} ج)</option>`).join("");
  select.addEventListener("change", () => {
    const opt = select.selectedOptions[0];
    if (opt) document.getElementById("pf_amount").value = opt.dataset.fee || "";
  });
  if (select.options.length) document.getElementById("pf_amount").value = select.options[0].dataset.fee || "";
}

/* ==========================================================
   مودال الدفع الأونلاين
   ========================================================== */
document.getElementById("openPayModalBtn").addEventListener("click", () => {
  document.getElementById("pm_vf").textContent = PAYMENT_INFO.vodafoneCash;
  document.getElementById("pm_bank").textContent = PAYMENT_INFO.bankName;
  document.getElementById("pm_acc").textContent = PAYMENT_INFO.bankAccount;
  document.getElementById("payModal").classList.remove("hidden");
});
document.getElementById("closePayModal").addEventListener("click", () => document.getElementById("payModal").classList.add("hidden"));

const uploadBox = document.getElementById("uploadBox");
const pf_image = document.getElementById("pf_image");
let uploadedImageDataUrl = null;

uploadBox.addEventListener("click", () => pf_image.click());
pf_image.addEventListener("change", async () => {
  const file = pf_image.files[0];
  if (!file) return;
  uploadedImageDataUrl = await fileToBase64(file);
  const preview = document.getElementById("uploadPreview");
  preview.src = uploadedImageDataUrl;
  preview.classList.remove("hidden");
  document.getElementById("uploadHint").textContent = "تم اختيار الصورة ✓ (اضغط للتغيير)";
});

document.getElementById("payForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentCode || !currentStudent) return;
  if (!uploadedImageDataUrl) return showToast("ارفع صورة إثبات التحويل أولاً", "error");

  const btn = document.getElementById("payFormBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> جاري الإرسال...';

  try {
    const select = document.getElementById("pf_subject");
    const opt = select.selectedOptions[0];
    const monthKey = currentMonthKey();

    // ضغط الصورة وتقليل حجمها تلقائياً قبل الرفع
    const compressedImage = await compressBase64(uploadedImageDataUrl, 600, 0.6);

    await db.ref("paymentRequests").push({
      code: currentCode,
      name: currentStudent.name,
      subjectKey: opt.value,
      subjectName: opt.dataset.name,
      amount: document.getElementById("pf_amount").value,
      phone: document.getElementById("pf_phone").value.trim(),
      month: monthKey,
      image: compressedImage,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    showToast("تم إرسال طلب الدفع، هيتم مراجعته من الإدارة قريباً", "success");
    document.getElementById("payModal").classList.add("hidden");
    document.getElementById("payForm").reset();
    document.getElementById("uploadPreview").classList.add("hidden");
    document.getElementById("uploadHint").textContent = "اضغط لاختيار صورة";
    uploadedImageDataUrl = null;
  } catch (err) {
    showToast("حدث خطأ أثناء الإرسال: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "إرسال للمراجعة";
  }
});

function lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({ key, label: monthKeyArabic(d) + " " + d.getFullYear() });
  }
  return months;
}

/* ==========================================================
   صندوق الشكاوى والاستفسارات (شات مع الإدارة)
   المحادثات بتتخزن في supportChats/{code}/messages
   وبتتحذف تلقائياً بعد 24 ساعة (التنظيف بيحصل من لوحة الأدمن)
   ========================================================== */
const supportFab = document.getElementById("supportFab");
const supportPanelBox = document.getElementById("supportPanelBox");
let supportListenerAttached = false;

if (supportFab) {
  supportFab.addEventListener("click", () => {
    if (!currentCode) return showToast("لسه بيانات الطالب بتتحمل، حاول تاني بعد لحظة", "error");
    supportPanelBox.classList.toggle("hidden");
    if (!supportPanelBox.classList.contains("hidden")) attachSupportListener();
  });
  document.getElementById("supportPanelClose").addEventListener("click", () => supportPanelBox.classList.add("hidden"));

  document.getElementById("sp_send").addEventListener("click", sendSupportMessage);
  document.getElementById("sp_input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendSupportMessage(); });
}

function attachSupportListener() {
  if (supportListenerAttached || !currentCode) return;
  supportListenerAttached = true;
  db.ref("supportChats/" + currentCode + "/messages").on("value", (snap) => {
    const wrap = document.getElementById("sp_messages");
    if (!snap.exists()) { wrap.innerHTML = '<p style="color:var(--text-light); font-size:12.5px; text-align:center;">اكتب استفسارك وهيتم الرد عليك من الإدارة قريباً</p>'; return; }
    const msgs = Object.values(snap.val()).sort((a, b) => (a.at || 0) - (b.at || 0));
    wrap.innerHTML = msgs
      .map((m) => `<div style="text-align:${m.from === "admin" ? "right" : "left"}; margin-bottom:6px;"><span style="display:inline-block; background:${m.from === "admin" ? "var(--bg)" : "var(--purple)"}; color:${m.from === "admin" ? "var(--text-dark)" : "#fff"}; padding:6px 10px; border-radius:8px; font-size:13px;">${escapeHtml(m.text)}</span></div>`)
      .join("");
    wrap.scrollTop = wrap.scrollHeight;
  });
}

async function sendSupportMessage() {
  if (!currentCode || !currentStudent) return;
  const input = document.getElementById("sp_input");
  const text = input.value.trim();
  if (!text) return;
  await db.ref(`supportChats/${currentCode}/messages`).push({ text, from: "student", at: Date.now() });
  await db.ref(`supportChats/${currentCode}`).update({ studentName: currentStudent.name, lastAt: Date.now() });
  input.value = "";
}
