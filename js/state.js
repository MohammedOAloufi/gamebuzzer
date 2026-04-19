/**
 * state.js
 * الحالة المشتركة عبر التطبيق كله — لا يحتوي على UI أو Firebase write operations
 */

import { db, ref, onValue } from "./firebase.js";
import { createDeviceId } from "./utils.js";

// ─────────────────────────────────────────────
// Team Colors
// ─────────────────────────────────────────────

export const TEAM_COLORS = [
  "team-blue",
  "team-red",
  "team-green",
  "team-purple",
  "team-orange",
  "team-yellow",
  "team-cyan",
];

// ─────────────────────────────────────────────
// Timing Constants
// ─────────────────────────────────────────────

export const PLAYER_ACTIVE_WINDOW_MS = 120000;  // 2 دقائق
export const SESSION_IDLE_DELETE_MS  = 600000;  // 10 دقائق
export const PLAYER_HEARTBEAT_MS     = 15000;   // 15 ثانية
export const HOST_HEARTBEAT_MS       = 20000;   // 20 ثانية
export const SESSION_EXPIRY_MS       = 600000;  // 10 دقائق

// ─────────────────────────────────────────────
// Page Detection
// ─────────────────────────────────────────────

export const pageType = (() => {
  const path = window.location.pathname.toLowerCase();

  if (path.endsWith("/host.html") || path.includes("host.html")) return "host";
  if (path.endsWith("/player.html") || path.includes("player.html")) return "player";

  return "home";
})();

// ─────────────────────────────────────────────
// Shared Local State
// ─────────────────────────────────────────────

export const local = {
  // Session
  currentSessionCode: "",
  unsubscribeSession: null,
  deviceId: createDeviceId(),
  lastSession: null,
  lastQrCodeValue: "",
  lastTeamsRenderKey: "",

  // Player identity
  joinedPlayer: false,
  playerTeamId: null,
  playerName: "",

  // UI ticker
  uiTickerStarted: false,
  uiTicker: null,

  // Heartbeats & workers (host)
  hostHeartbeat: null,
  hostTickWorker: null,

  // Heartbeats (player)
  playerHeartbeat: null,

  // Server clock sync
  serverTimeOffsetMs: 0,
  serverClockReady: false,

  // ── Buzz state ───────────────────────────────
  // هل يوجد طلب buzz قيد المعالجة الآن؟
  playerBuzzInFlight: false,

  // الجولة التي سجّل فيها اللاعب ضغطة مؤكدة (من الخادم)
  playerAttemptRoundId: null,

  // الجولة الأخيرة التي رأتها الـ UI — تُستخدم لكشف تغيّر الجولة
  playerUiRoundId: null,

  // آخر قيمة لـ forceUnlockToken شاهدتها الـ UI
  lastSeenForceUnlockToken: 0,

  // آخر توقيت تشغيل حقيقي لزر الـ buzz — يمنع الـ debounce من تجاهل الضغطة
  // بعد فك القفل مباشرة
  lastPressTriggerAt: 0,

  // مرجع الـ timeout الذي يفك قفل الـ buzz تلقائياً عند الانتهاء
  buzzInflightTimer: null,

  // رقم فريد لكل طلب buzz — يمنع finally قديم من التدخل في طلب جديد
  buzzToken: 0,

  // ✅ جديد: توقيت بدء الـ buzz الحالي — يُستخدم كـ safety valve في renderSession
  // لكشف الـ locks التي تجاوزت العمر الطبيعي دون أن ينتهي الـ timeout لسبب ما
  buzzStartedAt: 0,
};

// ─────────────────────────────────────────────
// Server Clock
// ─────────────────────────────────────────────

export function getServerNow() {
  return Date.now() + Number(local.serverTimeOffsetMs || 0);
}

const serverOffsetRef = ref(db, ".info/serverTimeOffset");

onValue(
  serverOffsetRef,
  (snapshot) => {
    local.serverTimeOffsetMs = Number(snapshot.val() || 0);
    local.serverClockReady = true;
  },
  () => {
    local.serverTimeOffsetMs = 0;
    local.serverClockReady = false;
  },
);