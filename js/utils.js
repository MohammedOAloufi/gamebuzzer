/**
 * utils.js
 * دوال مساعدة مشتركة — خالية من أي اعتماد على Firebase أو DOM أو State
 */

// ─────────────────────────────────────────────
// Device & Session ID helpers
// ─────────────────────────────────────────────

export function createDeviceId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * يولّد كود جلسة عشوائي باستخدام crypto.getRandomValues
 * (آمن تشفيرياً بخلاف Math.random)
 *
 * ملاحظة: الـ charset يحتوي 32 حرفاً، و256 ÷ 32 = 8 بالضبط
 * مما يعني لا يوجد modulo bias في التوزيع.
 */
export function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomBytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";

  for (let i = 0; i < length; i++) {
    code += chars[randomBytes[i] % chars.length];
  }

  return code;
}

// ─────────────────────────────────────────────
// Team color & name helpers
// ─────────────────────────────────────────────

export function getTeamDisplayNameByColor(colorClass) {
  const names = {
    "team-blue": "الفريق الأزرق",
    "team-red": "الفريق الأحمر",
    "team-green": "الفريق الأخضر",
    "team-purple": "الفريق البنفسجي",
    "team-orange": "الفريق البرتقالي",
    "team-yellow": "الفريق الأصفر",
    "team-cyan": "الفريق السماوي",
  };

  return names[colorClass] || "فريق جديد";
}

// ─────────────────────────────────────────────
// String sanitization & escaping
// ─────────────────────────────────────────────

/**
 * يهرّب HTML لمنع XSS عند الإدراج في innerHTML
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * يُنظّف اسم اللاعب:
 * - يحذف < > " ' & (منع XSS على مستوى التخزين أيضاً)
 * - يُقطع عند 40 حرفاً
 */
export function sanitizeName(value) {
  const clean = String(value || "")
    .replace(/[<>"'&]/g, "")
    .trim();

  return clean.slice(0, 40);
}

// ─────────────────────────────────────────────
// URL helpers
// ─────────────────────────────────────────────

export function getBaseUrl() {
  return `${window.location.origin}${window.location.pathname.replace(
    /[^/]+$/,
    "",
  )}`;
}

export function getPlayerJoinUrl(code = "") {
  return `${getBaseUrl()}player.html?session=${encodeURIComponent(code)}`;
}

// ─────────────────────────────────────────────
// Audio helper — مشترك بين host-controller و ui-renderer
// ─────────────────────────────────────────────

/**
 * يشغّل عنصر صوت بأمان مع تجاهل أي خطأ autoplay
 * @param {HTMLAudioElement|null} audioEl
 */
export function playAudioSafe(audioEl) {
  if (!audioEl) return;

  try {
    audioEl.pause();
    audioEl.currentTime = 0;

    const playPromise = audioEl.play();

    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  } catch (error) {
    console.error("playAudioSafe error:", error);
  }
}