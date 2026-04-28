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
      id: "home",
      label: "الصفحة الرئيسية",
      title: "صفحة الدخول",
      desc: "من هنا تبدأ — إما بإنشاء جلسة جديدة، أو الانضمام لجلسة موجودة.",
      items: [
        { img: "screens/home/create.png", title: "إنشاء الجلسة",
          desc: "اضغط لبدء جلسة جديدة كمشرف." },
        { img: "screens/home/code.png", title: "كود الجلسة",
          desc: "اكتب الكود الذي تلقيته من المشرف هنا." },
        { img: "screens/home/join.png", title: "دخول إلى الجلسة",
          desc: "بعد كتابة الكود، اضغط هنا للانضمام." },
      ],
    },
    {
      id: "host",
      label: "لوحة المشرف",
      title: "لوحة المشرف",
      desc: "إدارة الجلسة والفرق والجولات بشكل مباشر.",
      items: [
        { img: "screens/host/team.png", title: "أزرار الفرق",
          desc: "تعرض الفرق وتمكّنك من إدارتها وإضافة النقاط." },
        { img: "screens/host/deleteTeam.png", title: "حذف فريق",
          desc: "لإزالة فريق من الجلسة." },
        { img: "screens/host/time.png", title: "وقت الإجابة",
          desc: "لضبط مدة الجولة المتاحة للضغط." },
        { img: "screens/host/cooldownTime.png", title: "وقت منع الضغط",
          desc: "لضبط الفترة التي يُمنع فيها الضغط المبكر." },
        { img: "screens/host/openForAll.png", title: "بدء الجولة",
          desc: "لتشغيل الجولة وفتح الضغط للجميع." },
        { img: "screens/host/deleteWinner.png", title: "مسح الفائز",
          desc: "لإعادة الجولة بعد إعلان الفائز." },
        { img: "screens/host/closeBtn.png", title: "إغلاق الجلسة",
          desc: "لإنهاء الجلسة بشكل نهائي." },
      ],
    },
    {
      id: "player",
      label: "شاشة اللاعب",
      title: "شاشة اللاعب",
      desc: "هذه ما يراه اللاعب على جواله أثناء الجلسة.",
      items: [
        { img: "screens/player/answerTime.png", title: "وقت الإجابة",
          desc: "العداد الذي يخبر اللاعب متى يبدأ الضغط." },
        { img: "screens/player/cooldownTimer.png", title: "وقت المنع",
          desc: "الفترة التي يُمنع فيها الضغط المبكر." },
        { img: "screens/player/currentTeam.png", title: "اسم الفريق",
          desc: "تأكد أنك انضممت للفريق الصحيح." },
        { img: "screens/player/point.png", title: "نقاط الفريق",
          desc: "عدد النقاط الحالية لفريقك." },
        { img: "screens/player/Buzz.png", title: "زر الضغط الكبير",
          desc: "اضغطه فور سماعك للسؤال (بعد انتهاء وقت المنع)." },
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

  // تهريب لاستخدامه داخل قيم السمات (نفس escapeHtml — مُعرَّفة لقراءة أوضح)
  function escapeAttr(str) {
    return escapeHtml(str);
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
  // عرض الشاشة الحالية (بطاقات أفقية)
  // ----------------------------------------------------------------
  function renderCurrent() {
    if (!bodyEl) return;
    const screen = GUIDE_DATA[currentIndex];
    const stepText = "الشاشة " + (currentIndex + 1) + " من " + GUIDE_DATA.length;

    const cardsHtml = screen.items.map(function (item) {
      return (
        '<div class="gm-card">' +
          '<div class="gm-card__body">' +
            '<h4 class="gm-card__title">' + escapeHtml(item.title) + '</h4>' +
            '<p class="gm-card__desc">' + escapeHtml(item.desc) + '</p>' +
          '</div>' +
          '<div class="gm-card__img-wrap">' +
            '<img class="gm-card__img"' +
            ' src="' + escapeAttr(item.img) + '"' +
            ' alt="' + escapeAttr(item.title) + '"' +
            ' loading="lazy"' +
            ' onerror="this.style.opacity=\'0.25\'" />' +
          '</div>' +
        '</div>'
      );
    }).join("");

    bodyEl.innerHTML =
      '<div class="gm-screen-header">' +
        '<div class="gm-screen-step">' + escapeHtml(stepText) + '</div>' +
        '<h3 class="gm-screen-title">' + escapeHtml(screen.title) + '</h3>' +
        '<p class="gm-screen-desc">' + escapeHtml(screen.desc) + '</p>' +
      '</div>' +
      '<div class="gm-cards">' + cardsHtml + '</div>';

    bodyEl.scrollTop = 0;

    // تحديث التابات والنقاط
    Array.prototype.forEach.call(tabsEl.children, function (tab, idx) {
      const isActive = idx === currentIndex;
      tab.classList.toggle("gm-tab--active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    Array.prototype.forEach.call(dotsEl.children, function (d, idx) {
      d.classList.toggle("gm-dot--active", idx === currentIndex);
    });

    // أزرار التنقّل
    prevBtn.disabled = currentIndex === 0;
    nextBtn.textContent = currentIndex === GUIDE_DATA.length - 1 ? "إنهاء" : "التالي";
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
