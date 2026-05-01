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

// ─────────────────────────────────────────────
// Mobile audio unlock — يفك حظر تشغيل الصوت على الجوال
// (iOS/Android تطلب user gesture قبل أول تشغيل)
// ─────────────────────────────────────────────

const _audioUnlockRegistry = new Set();
let _audioUnlockInstalled = false;
let _audioUnlocked = false;

/**
 * يسجّل عنصر صوت لكي يُفك حظره عند أول لمسة من المستخدم.
 * يمكن استدعاؤه بأمان عدة مرات لنفس العنصر.
 */
export function registerAudioForUnlock(audioEl) {
  if (!audioEl) return;
  _audioUnlockRegistry.add(audioEl);

  // إذا كان الصوت مفكوكاً بالفعل، فك العنصر الجديد فوراً
  if (_audioUnlocked) {
    _primeAudio(audioEl);
  }
}

function _primeAudio(audioEl) {
  try {
    const wasMuted = audioEl.muted;
    audioEl.muted = true;
    const p = audioEl.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        audioEl.pause();
        audioEl.currentTime = 0;
        audioEl.muted = wasMuted;
      }).catch(() => {
        audioEl.muted = wasMuted;
      });
    } else {
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl.muted = wasMuted;
    }
  } catch (_) {
    /* ignore */
  }
}

/**
 * يثبّت listeners عامة على document لفك حظر الصوت
 * عند أول tap/click/keydown من المستخدم.
 */
export function installAudioUnlock() {
  if (_audioUnlockInstalled || typeof document === "undefined") return;
  _audioUnlockInstalled = true;

  const unlock = () => {
    if (_audioUnlocked) return;
    _audioUnlocked = true;

    _audioUnlockRegistry.forEach((el) => _primeAudio(el));

    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("touchstart", unlock, true);
    document.removeEventListener("click", unlock, true);
    document.removeEventListener("keydown", unlock, true);
  };

  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("touchstart", unlock, true);
  document.addEventListener("click", unlock, true);
  document.addEventListener("keydown", unlock, true);
}

// ─────────────────────────────────────────────
// Web Audio Tick — حل موثوق لـ iOS/Android
// يستخدم AudioContext + AudioBuffer لتشغيل صوت قصير بدون حدود
// (هذا أفضل من <audio> لأن iOS يقفل play() بعد فترة على عناصر HTMLAudio)
// ─────────────────────────────────────────────

let _audioCtx = null;
const _audioBuffers = new Map(); // url -> AudioBuffer
const _pendingBuffers = new Map(); // url -> Promise

function _getAudioCtx() {
  if (_audioCtx) return _audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    _audioCtx = new Ctx();
  } catch (_) {
    return null;
  }
  return _audioCtx;
}

/**
 * يحمّل ملف صوت إلى AudioBuffer جاهز للتشغيل الفوري
 */
export function preloadAudioBuffer(url) {
  if (!url) return Promise.resolve(null);
  if (_audioBuffers.has(url)) return Promise.resolve(_audioBuffers.get(url));
  if (_pendingBuffers.has(url)) return _pendingBuffers.get(url);

  const ctx = _getAudioCtx();
  if (!ctx) return Promise.resolve(null);

  const promise = fetch(url)
    .then((res) => res.arrayBuffer())
    .then(
      (data) =>
        new Promise((resolve, reject) => {
          // الصياغة القديمة لـ decodeAudioData مدعومة على Safari
          ctx.decodeAudioData(
            data,
            (buf) => resolve(buf),
            (err) => reject(err),
          );
        }),
    )
    .then((buf) => {
      _audioBuffers.set(url, buf);
      _pendingBuffers.delete(url);
      return buf;
    })
    .catch((err) => {
      console.error("preloadAudioBuffer error:", url, err);
      _pendingBuffers.delete(url);
      return null;
    });

  _pendingBuffers.set(url, promise);
  return promise;
}

/**
 * يشغّل buffer مُحمّل مسبقاً عبر Web Audio API.
 * موثوق على iOS/Android طالما الـ AudioContext مفكوك.
 */
export function playAudioBuffer(url, { volume = 1 } = {}) {
  const ctx = _getAudioCtx();
  if (!ctx) return;

  // محاولة استئناف الـ context (iOS يعلّقه أحياناً)
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const buffer = _audioBuffers.get(url);
  if (!buffer) {
    // إذا لم يكن محمّلاً، حمّله ثم شغّل (قد يتأخر مرة واحدة فقط)
    preloadAudioBuffer(url).then((buf) => {
      if (buf) playAudioBuffer(url, { volume });
    });
    return;
  }

  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain).connect(ctx.destination);
    source.start(0);
  } catch (err) {
    console.error("playAudioBuffer error:", err);
  }
}

/**
 * يفك حظر AudioContext من user gesture (iOS/Android)
 */
function _unlockAudioContext() {
  const ctx = _getAudioCtx();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  // تشغيل buffer صامت لإجبار iOS على فتح القناة
  try {
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch (_) {
    /* ignore */
  }
}

// hook into existing installAudioUnlock listeners
const _origInstall = installAudioUnlock;
let _webAudioHooked = false;
export function installWebAudioUnlock() {
  if (_webAudioHooked || typeof document === "undefined") return;
  _webAudioHooked = true;

  const unlock = () => {
    _unlockAudioContext();
  };

  // pointerdown/touchstart/click تكفي لفك القناة على iOS/Android
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("touchstart", unlock, true);
  document.addEventListener("click", unlock, true);
  document.addEventListener("keydown", unlock, true);
}