/* ============================================================
   GameBuzzer User Guide — Vanilla JS (IIFE)
   لا يلوّث الـ window عدا API: window.GameBuzzerGuide
   ============================================================ */
(function () {
  "use strict";

  // ----------------------------------------------------------------
  // ثوابت ومفاتيح
  // ----------------------------------------------------------------
  const STORAGE_KEY = "gameBuzzer_guideDismissed_v1";
  const AUTO_OPEN_DELAY = 600;

  // ----------------------------------------------------------------
  // بيانات الدليل (3 شاشات)
  // ----------------------------------------------------------------
  const GUIDE_DATA = [
    {
      id: "login",
      label: "الصفحة الرئيسية",
      title: "صفحة الدخول",
      desc: "من هنا تبدأ — إما بإنشاء جلسة جديدة، أو الانضمام لجلسة موجودة.",
      image: "screens/home.png",
      items: [
        { num: 1, text: "<strong>إنشاء الجلسة</strong> — اضغط لبدء جلسة جديدة كمشرف.",
          pin: { x: 50, y: 47 }, ring: { x: 18, y: 43, w: 64, h: 8 } },
        { num: 2, text: "<strong>كود الجلسة</strong> — اكتب الكود الذي تلقيته من المشرف هنا.",
          pin: { x: 50, y: 65 }, ring: { x: 18, y: 60, w: 64, h: 9 } },
        { num: 3, text: "<strong>دخول إلى الجلسة</strong> — بعد كتابة الكود، اضغط هنا للانضمام.",
          pin: { x: 50, y: 76 }, ring: { x: 18, y: 72, w: 64, h: 8 } },
      ],
    },
    {
      id: "dashboard",
      label: "لوحة المشرف",
      title: "لوحة المشرف",
      desc: "إدارة الجلسة والفرق والجولات بشكل مباشر.",
      image: "screens/host.png",
      items: [
        { num: 1,  text: "<strong>إضافة فريق</strong> — لإضافة فريق جديد للجلسة.",
          pin: { x: 78, y: 28 }, ring: { x: 70, y: 24, w: 18, h: 8 } },
        { num: 2,  text: "<strong>عدّاد النقاط (+ / −)</strong> — لزيادة أو إنقاص نقاط كل فريق.",
          pin: { x: 75, y: 38 }, ring: { x: 67, y: 33, w: 20, h: 7 } },
        { num: 3,  text: "<strong>حذف فريق</strong> — لإزالة فريق من الجلسة.",
          pin: { x: 88, y: 38 }, ring: { x: 84, y: 33, w: 8, h: 7 } },
        { num: 4,  text: "<strong>وقت الإجابة ومدة منع الضغط</strong> — لضبط مؤقت الجولة.",
          pin: { x: 38, y: 30 }, ring: { x: 23, y: 25, w: 32, h: 8 } },
        { num: 5,  text: "<strong>بدء/إيقاف الجولة</strong> — لتشغيل الجولة وقفل الأزرار.",
          pin: { x: 25, y: 45 }, ring: { x: 18, y: 41, w: 18, h: 7 } },
        { num: 6,  text: "<strong>حل الإنذار</strong> — عند ضغط لاعب قبل الوقت.",
          pin: { x: 35, y: 45 }, ring: { x: 28, y: 41, w: 14, h: 7 } },
        { num: 7,  text: "<strong>مسح فائز</strong> — لإعادة الجولة بعد إعلان فائز.",
          pin: { x: 47, y: 45 }, ring: { x: 40, y: 41, w: 14, h: 7 } },
        { num: 8,  text: "<strong>QR ورابط الجلسة</strong> — شاركه مع اللاعبين للانضمام.",
          pin: { x: 32, y: 65 }, ring: { x: 22, y: 55, w: 22, h: 22 } },
        { num: 9,  text: "<strong>نسخ كود/رابط الجلسة</strong> — لمشاركتها بسرعة.",
          pin: { x: 60, y: 65 }, ring: { x: 48, y: 60, w: 25, h: 10 } },
        { num: 10, text: "<strong>أزرار الفرق</strong> — يضغطها اللاعبون أولاً.",
          pin: { x: 30, y: 80 }, ring: { x: 18, y: 75, w: 65, h: 12 } },
        { num: 11, text: "<strong>تم تجهيز الجلسة</strong> — مؤشر سفلي يؤكد جاهزية النظام.",
          pin: { x: 8, y: 92 }, ring: { x: 4, y: 88, w: 18, h: 7 } },
      ],
    },
    {
      id: "player",
      label: "شاشة اللاعب",
      title: "شاشة اللاعب",
      desc: "هذه ما يراه اللاعب على جواله أثناء الجلسة.",
      image: "screens/player.png",
      items: [
        { num: 1, text: "<strong>وقت الإجابة</strong> — العداد الذي يخبر اللاعب متى يبدأ الضغط.",
          pin: { x: 65, y: 28 }, ring: { x: 50, y: 18, w: 32, h: 18 } },
        { num: 2, text: "<strong>وقت المنع</strong> — يعرض الفترة التي يُمنع فيها الضغط المبكر.",
          pin: { x: 27, y: 24 }, ring: { x: 18, y: 18, w: 22, h: 14 } },
        { num: 3, text: "<strong>اسم الفريق</strong> — تأكد أنك انضممت للفريق الصحيح.",
          pin: { x: 30, y: 38 }, ring: { x: 20, y: 34, w: 22, h: 9 } },
        { num: 4, text: "<strong>نقاط الفريق</strong> — عدد النقاط الحالية لفريقك.",
          pin: { x: 12, y: 38 }, ring: { x: 4, y: 34, w: 16, h: 9 } },
        { num: 5, text: "<strong>زر الضغط الكبير</strong> — اضغطه فور سماعك للسؤال (بعد انتهاء وقت المنع).",
          pin: { x: 50, y: 75 }, ring: { x: 15, y: 55, w: 70, h: 38 } },
        { num: 6, text: "<strong>مؤشر الحالة</strong> — أخضر = نشط، رمادي = متوقف.",
          pin: { x: 88, y: 8 }, ring: { x: 78, y: 4, w: 18, h: 8 } },
      ],
    },
  ];

  // ----------------------------------------------------------------
  // الحالة الداخلية
  // ----------------------------------------------------------------
  let currentIndex = 0;
  let lastFocusedEl = null;
  let overlayEl = null;
  let tabsEl = null;
  let bodyEl = null;
  let dotsEl = null;
  let nextBtn = null;
  let prevBtn = null;
  let dontShowCheckbox = null;

  // ----------------------------------------------------------------
  // حماية XSS
  // ----------------------------------------------------------------
  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ----------------------------------------------------------------
  // بناء التابات
  // ----------------------------------------------------------------
  function buildTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = "";
    GUIDE_DATA.forEach((screen, idx) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "gm-tab" + (idx === currentIndex ? " gm-tab--active" : "");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", idx === currentIndex ? "true" : "false");
      tab.dataset.index = String(idx);
      tab.innerHTML =
        '<span class="gm-tab__num">' + (idx + 1) + '</span>' +
        '<span>' + escapeHtml(screen.label) + '</span>';
      tab.addEventListener("click", () => goTo(idx));
      tabsEl.appendChild(tab);
    });
  }

  // ----------------------------------------------------------------
  // بناء النقاط (dots)
  // ----------------------------------------------------------------
  function buildDots() {
    if (!dotsEl) return;
    dotsEl.innerHTML = "";
    GUIDE_DATA.forEach((_, idx) => {
      const d = document.createElement("span");
      d.className = "gm-dot" + (idx === currentIndex ? " gm-dot--active" : "");
      dotsEl.appendChild(d);
    });
  }

  // ----------------------------------------------------------------
  // عرض الشاشة الحالية
  // ----------------------------------------------------------------
  function renderCurrent() {
    if (!bodyEl) return;
    const screen = GUIDE_DATA[currentIndex];

    // عمود الصورة + الدبابيس + الإطار
    let pinsHtml = "";
    let ringsHtml = "";
    screen.items.forEach((item) => {
      pinsHtml +=
        '<button type="button" class="gm-pin" data-num="' + item.num + '"' +
        ' style="right:' + item.pin.x + '%;top:' + item.pin.y + '%;"' +
        ' aria-label="' + escapeHtml("الدبوس رقم " + item.num) + '">' +
        item.num + '</button>';
      ringsHtml +=
        '<span class="gm-ring" data-num="' + item.num + '"' +
        ' style="right:' + item.ring.x + '%;top:' + item.ring.y +
        '%;width:' + item.ring.w + '%;height:' + item.ring.h + '%;"></span>';
    });

    // عمود الشروحات
    let listHtml = "";
    screen.items.forEach((item) => {
      // ملاحظة: item.text يحتوي على <strong> متعمّد، يبقى كـ HTML
      listHtml +=
        '<li class="gm-item" tabindex="0" data-num="' + item.num + '">' +
        '<span class="gm-item__num">' + item.num + '</span>' +
        '<span class="gm-item__text">' + item.text + '</span>' +
        '</li>';
    });

    bodyEl.innerHTML =
      '<div class="gm-stage">' +
        '<img class="gm-stage__img" src="' + escapeHtml(screen.image) +
        '" alt="' + escapeHtml(screen.title) + '" />' +
        ringsHtml +
        pinsHtml +
      '</div>' +
      '<div class="gm-info">' +
        '<h3 class="gm-info__title">' + escapeHtml(screen.title) + '</h3>' +
        '<p class="gm-info__desc">' + escapeHtml(screen.desc) + '</p>' +
        '<ul class="gm-list">' + listHtml + '</ul>' +
      '</div>';

    // تحديث التابات والنقاط
    Array.prototype.forEach.call(tabsEl.children, (tab, idx) => {
      const isActive = idx === currentIndex;
      tab.classList.toggle("gm-tab--active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    Array.prototype.forEach.call(dotsEl.children, (d, idx) => {
      d.classList.toggle("gm-dot--active", idx === currentIndex);
    });

    // أزرار التنقّل
    prevBtn.disabled = currentIndex === 0;
    nextBtn.textContent = currentIndex === GUIDE_DATA.length - 1 ? "إنهاء" : "التالي";

    bindStageEvents();
  }

  // ----------------------------------------------------------------
  // ربط أحداث الدبابيس وعناصر القائمة
  // ----------------------------------------------------------------
  function bindStageEvents() {
    const items = bodyEl.querySelectorAll(".gm-item");
    const pins = bodyEl.querySelectorAll(".gm-pin");

    items.forEach((el) => {
      const num = el.dataset.num;
      el.addEventListener("mouseenter", () => setActiveItem(num));
      el.addEventListener("mouseleave", clearActiveItem);
      el.addEventListener("focus", () => setActiveItem(num));
      el.addEventListener("blur", clearActiveItem);
      el.addEventListener("click", () => setActiveItem(num));
    });

    pins.forEach((el) => {
      const num = el.dataset.num;
      el.addEventListener("mouseenter", () => setActiveItem(num));
      el.addEventListener("mouseleave", clearActiveItem);
      el.addEventListener("focus", () => setActiveItem(num));
      el.addEventListener("blur", clearActiveItem);
      el.addEventListener("click", () => setActiveItem(num));
    });
  }

  // ----------------------------------------------------------------
  // تفعيل عنصر/دبوس/إطار
  // ----------------------------------------------------------------
  function setActiveItem(num) {
    bodyEl.querySelectorAll(".gm-pin").forEach((el) => {
      el.classList.toggle("gm-pin--active", el.dataset.num === num);
    });
    bodyEl.querySelectorAll(".gm-ring").forEach((el) => {
      el.classList.toggle("gm-ring--active", el.dataset.num === num);
    });
    bodyEl.querySelectorAll(".gm-item").forEach((el) => {
      el.classList.toggle("gm-item--active", el.dataset.num === num);
    });
  }

  function clearActiveItem() {
    bodyEl.querySelectorAll(".gm-pin--active").forEach((el) =>
      el.classList.remove("gm-pin--active"));
    bodyEl.querySelectorAll(".gm-ring--active").forEach((el) =>
      el.classList.remove("gm-ring--active"));
    bodyEl.querySelectorAll(".gm-item--active").forEach((el) =>
      el.classList.remove("gm-item--active"));
  }

  // ----------------------------------------------------------------
  // ربط الأحداث العامة
  // ----------------------------------------------------------------
  function bindEvents() {
    // محفّزات الفتح
    document.querySelectorAll("[data-gm-trigger]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        open();
      });
    });

    // أزرار الإغلاق
    overlayEl.querySelectorAll("[data-gm-close]").forEach((el) => {
      el.addEventListener("click", close);
    });

    // الضغط خارج المودال
    overlayEl.addEventListener("click", (e) => {
      if (e.target === overlayEl) close();
    });

    // أزرار السابق/التالي
    nextBtn.addEventListener("click", () => {
      if (currentIndex === GUIDE_DATA.length - 1) {
        close();
      } else {
        goTo(currentIndex + 1);
      }
    });
    prevBtn.addEventListener("click", () => {
      if (currentIndex > 0) goTo(currentIndex - 1);
    });

    // المفاتيح
    document.addEventListener("keydown", handleKeydown);
  }

  // ----------------------------------------------------------------
  // التنقّل بلوحة المفاتيح (RTL-aware)
  // ----------------------------------------------------------------
  function handleKeydown(e) {
    if (!overlayEl.classList.contains("gm-open")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowRight") {
      // RTL: السهم الأيمن = السابق
      e.preventDefault();
      if (currentIndex > 0) goTo(currentIndex - 1);
    } else if (e.key === "ArrowLeft") {
      // RTL: السهم الأيسر = التالي
      e.preventDefault();
      if (currentIndex < GUIDE_DATA.length - 1) goTo(currentIndex + 1);
    }
  }

  // ----------------------------------------------------------------
  // الانتقال إلى شاشة معيّنة
  // ----------------------------------------------------------------
  function goTo(idx) {
    if (idx < 0 || idx >= GUIDE_DATA.length) return;
    currentIndex = idx;
    renderCurrent();
  }

  // ----------------------------------------------------------------
  // فتح المودال
  // ----------------------------------------------------------------
  function open() {
    if (!overlayEl) return;
    lastFocusedEl = document.activeElement;
    overlayEl.classList.add("gm-open");
    overlayEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    currentIndex = 0;
    renderCurrent();
    // نقل الـ focus لزر الإغلاق
    const closeBtn = overlayEl.querySelector("[data-gm-close]");
    if (closeBtn) closeBtn.focus();
  }

  // ----------------------------------------------------------------
  // إغلاق المودال
  // ----------------------------------------------------------------
  function close() {
    if (!overlayEl) return;
    overlayEl.classList.remove("gm-open");
    overlayEl.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";

    // حفظ خيار "لا تُظهر تلقائياً" — يُسجَّل دائماً عند أول إغلاق
    try {
      if (dontShowCheckbox && dontShowCheckbox.checked) {
        localStorage.setItem(STORAGE_KEY, "1");
      } else {
        // نسجّل أيضاً أنه أُغلق ولو مرة (وفق المتطلبات)
        localStorage.setItem(STORAGE_KEY, "1");
      }
    } catch (_) { /* ignore */ }

    // إعادة الـ focus
    if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
      lastFocusedEl.focus();
    }
  }

  // ----------------------------------------------------------------
  // التهيئة
  // ----------------------------------------------------------------
  function init() {
    overlayEl = document.getElementById("gmOverlay");
    if (!overlayEl) return; // الصفحة لا تحتوي المودال

    tabsEl = overlayEl.querySelector(".gm-tabs");
    bodyEl = overlayEl.querySelector(".gm-body");
    dotsEl = overlayEl.querySelector(".gm-dots");
    nextBtn = overlayEl.querySelector("[data-gm-next]");
    prevBtn = overlayEl.querySelector("[data-gm-prev]");
    dontShowCheckbox = overlayEl.querySelector("#gmDontShow");

    buildTabs();
    buildDots();
    bindEvents();

    // فتح تلقائي أول زيارة فقط
    let dismissed = false;
    try { dismissed = localStorage.getItem(STORAGE_KEY) === "1"; } catch (_) {}
    if (!dismissed) {
      setTimeout(open, AUTO_OPEN_DELAY);
    }
  }

  // ----------------------------------------------------------------
  // API عام
  // ----------------------------------------------------------------
  window.GameBuzzerGuide = {
    open: open,
    close: close,
    reset: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    },
  };

  // تشغيل تلقائي عند جاهزية الـ DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
