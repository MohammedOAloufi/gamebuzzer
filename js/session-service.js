/**
 * session-service.js
 * طبقة البيانات — كل العمليات على Firebase للجلسات
 *
 * 🏗️ معمارية جديدة (Host-as-Authority):
 * ═══════════════════════════════════════
 * اللاعب (claimBuzz):
 *   - يكتب press في مكانه الخاص فقط: sessions/{code}/presses/{deviceId}
 *   - لا يلمس winnerTeamId أو locked — تلك مسؤولية المشرف
 *   - لا transactions، لا WebSocket closes، لا retry loops
 *
 * المشرف (resolvePressesToWinner):
 *   - يراقب presses عبر onValue
 *   - عند وصول أول press في جولة، يحاول أخذ resolution lock ذري
 *   - إذا أخذ القفل، يختار الأسبق ويكتبه كـ winner
 *   - يضبط locked, timerRunning, roundEndsAt الخ
 *
 * هذا يمنع دخول أكثر من مسار حسم لنفس الجولة في نفس اللحظة.
 */

import { db, ref, set, update, get, runTransaction } from "./firebase.js";
import {
  TEAM_COLORS,
  SESSION_EXPIRY_MS,
  local,
  getServerNow,
} from "./state.js";
import { sanitizeName, getTeamDisplayNameByColor } from "./utils.js";
import { els } from "./dom.js";

// ─────────────────────────────────────────────
// Resolution Lock — Constants & Helpers
// ─────────────────────────────────────────────
//
// القفل الذري الذي يضمن حاسم واحد فقط لكل roundId.
// • TTL قصير (2500ms) = self-healing تلقائي لو crash الـ host
// • owner فريد لكل محاولة = يمنع release لقفل غيرك
// • roundId داخل القفل = يعزل القفل بجولته
//
const RESOLUTION_LOCK_TTL_MS = 2500;

/**
 * القيمة الموحّدة للقفل الفارغ.
 * تُستخدم في كل المواضع التي تصفّر فيها الجولة أو تنتهي،
 * حتى لا ينفلت literal في مكان فيُسبّب "عَلَق" في القفل.
 */
export const EMPTY_RESOLUTION_LOCK = Object.freeze({
  active: false,
  roundId: 0,
  owner: "",
  createdAt: 0,
  expiresAt: 0,
});

/**
 * يُرجع نسخة قابلة للكتابة — لأن Firebase لا يقبل Frozen objects مباشرة
 * في بعض الحالات، ولأن الـ consumer قد يدمج حقولاً أخرى.
 */
export function emptyResolutionLock() {
  return { ...EMPTY_RESOLUTION_LOCK };
}

// ─────────────────────────────────────────────
// Default Data
// ─────────────────────────────────────────────

export function defaultTeams() {
  return [
    {
      id: 1,
      name: getTeamDisplayNameByColor("team-blue"),
      colorClass: "team-blue",
      points: 0,
    },
    {
      id: 2,
      name: getTeamDisplayNameByColor("team-red"),
      colorClass: "team-red",
      points: 0,
    },
  ];
}

// ─────────────────────────────────────────────
// Firebase Refs
// ─────────────────────────────────────────────

export function sessionRef(code) {
  return ref(db, `sessions/${code}`);
}

export function presenceRef(code) {
  return ref(db, `sessions/${code}/presence/${local.deviceId}`);
}

export function pressesRef(code) {
  return ref(db, `sessions/${code}/presses`);
}

export function myPressRef(code) {
  return ref(db, `sessions/${code}/presses/${local.deviceId}`);
}

export function resolutionLockRef(code) {
  return ref(db, `sessions/${code}/resolutionLock`);
}

// ─────────────────────────────────────────────
// Session Normalization
// ─────────────────────────────────────────────

export function normalizeSession(raw, code) {
  const safeTeams =
    Array.isArray(raw?.teams) && raw.teams.length > 0
      ? raw.teams
      : defaultTeams();

  const parsedTimeLeft = Number(raw?.timeLeft);
  const parsedMaxTime = Number(raw?.maxTime);
  const parsedCooldown = Number(raw?.cooldown);
  const parsedExpiresAt = Number(raw?.expiresAt);
  const parsedRoundId = Number(raw?.roundId);
  const parsedForceUnlockToken = Number(raw?.forceUnlockToken);

  const safePresses =
    raw?.presses && typeof raw?.presses === "object" ? raw.presses : {};

  const resolutionLock =
    raw?.resolutionLock && typeof raw?.resolutionLock === "object"
      ? raw.resolutionLock
      : {};

  return {
    code,
    locked: Boolean(raw?.locked),
    timerRunning: Boolean(raw?.timerRunning),
    answerExpired: Boolean(raw?.answerExpired),
    timeLeft: Number.isFinite(parsedTimeLeft) ? parsedTimeLeft : 3,
    maxTime: Number.isFinite(parsedMaxTime) ? parsedMaxTime : 3,
    roundId: Number.isFinite(parsedRoundId) ? parsedRoundId : 1,
    forceUnlockToken: Number.isFinite(parsedForceUnlockToken)
      ? parsedForceUnlockToken
      : 0,
    winnerTeamId:
      raw?.winnerTeamId === null || raw?.winnerTeamId === undefined
        ? null
        : Number(raw.winnerTeamId),
    winnerPlayerName: String(raw?.winnerPlayerName || ""),
    winnerPlayerId: String(raw?.winnerPlayerId || ""),
    winnerPressedAt: raw?.winnerPressedAt ?? null,
    roundStartedAt: raw?.roundStartedAt ?? null,
    roundEndsAt: raw?.roundEndsAt ?? null,
    hostUpdatedAt: raw?.hostUpdatedAt ?? null,
    updatedAt: raw?.updatedAt ?? null,
    createdAt: raw?.createdAt ?? null,
    expiresAt: Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : null,
    cooldown: Number.isFinite(parsedCooldown) ? parsedCooldown : 0,
    cooldownEndsAt: raw?.cooldownEndsAt ?? null,
    cooldownPlayerId: String(raw?.cooldownPlayerId || ""),
    cooldownTeamId:
      raw?.cooldownTeamId === null || raw?.cooldownTeamId === undefined
        ? null
        : Number(raw.cooldownTeamId),
    resolutionLock: {
      ...emptyResolutionLock(),
      active: Boolean(resolutionLock.active),
      roundId: Number(resolutionLock.roundId || 0),
      owner: String(resolutionLock.owner || ""),
      expiresAt: Number(resolutionLock.expiresAt || 0),
      createdAt: Number(resolutionLock.createdAt || 0),
    },
    presence:
      raw?.presence && typeof raw?.presence === "object" ? raw.presence : {},
    presses: Object.entries(safePresses).reduce((acc, [deviceId, press]) => {
      if (!press || typeof press !== "object") return acc;

      acc[deviceId] = {
        deviceId,
        teamId: Number(press.teamId),
        playerName: String(press.playerName || ""),
        pressedAt: Number(press.pressedAt || 0),
        roundId: Number(press.roundId || 1),
      };

      return acc;
    }, {}),
    teams: safeTeams.map((team) => ({
      id: Number(team.id),
      name: String(team.name || "فريق"),
      colorClass: String(team.colorClass || "team-slate"),
      points: Number(team.points || 0),
    })),
  };
}

// ─────────────────────────────────────────────
// Session Query Helpers
// ─────────────────────────────────────────────

export function getWinnerTeam(session) {
  return session.teams.find((team) => team.id === session.winnerTeamId) || null;
}

export function getSelectedTeamId() {
  if (local.joinedPlayer && Number.isFinite(local.playerTeamId)) {
    return Number(local.playerTeamId);
  }

  if (!els.selectedTeam) return null;
  return Number(els.selectedTeam.value);
}

export function getSelectedTeam(session) {
  const selectedId = getSelectedTeamId();
  return session.teams.find((team) => team.id === selectedId) || null;
}

export function getCurrentPlayerName() {
  if (local.joinedPlayer && local.playerName) {
    return local.playerName;
  }

  return sanitizeName(els.deviceName?.value) || "لاعب";
}

export function isMyCooldownActive(session) {
  const selectedTeamId = getSelectedTeamId();
  const serverNow = getServerNow();

  return (
    Number.isFinite(selectedTeamId) &&
    session.cooldownTeamId !== null &&
    Number(session.cooldownTeamId) === Number(selectedTeamId) &&
    Boolean(session.cooldownEndsAt) &&
    serverNow < Number(session.cooldownEndsAt)
  );
}

export function hasMyPressInCurrentRound(session) {
  const myPress = session.presses?.[local.deviceId];
  if (!myPress) return false;

  return Number(myPress.roundId) === Number(session.roundId);
}

export function getBuzzBlockReason(session, options = {}) {
  const { strict = false } = options;

  if (!local.joinedPlayer) return "join_required";
  if (session.locked) return "round_locked";
  if (isMyCooldownActive(session)) return "team_cooldown";

  if (session.winnerTeamId !== null && !session.answerExpired) {
    if (session.winnerPlayerId && session.winnerPlayerId !== local.deviceId) {
      return "another_player_won";
    }
    return "round_locked";
  }

  if (strict) {
    if (hasMyPressInCurrentRound(session)) return "already_pressed_this_round";
  }

  return null;
}

export function canBuzz(session) {
  return getBuzzBlockReason(session, { strict: true }) === null;
}

/**
 * ⚡ Provisional Winner — عرض فوري للفائز المرجَّح قبل أن يُوثّقه الـ resolver.
 *
 * لماذا؟ Firebase RTDB يطبّق الكتابات محلياً (`applyLocally`) فور كتابتها.
 * بمجرد أن يضغط لاعب، تظهر ضغطته في `session.presses` لكل العملاء خلال
 * ~50ms (وفي نفس الجهاز فوراً قبل الخادم). ننتظر الـ resolver (~250ms)
 * لا معنى له — نطبّق نفس منطقه محلياً للعرض.
 *
 * الـ resolver يبقى مصدر الحقيقة؛ عندما يكتب الفائز فعلياً، winnerTeamId
 * يصبح غير null وهذه الدالة تتوقف عن العمل تلقائياً. 100% اتساق.
 *
 * @param {object} session normalized session
 * @returns {object} نفس الـ session أو نسخة معدَّلة مع فائز مؤقت + علامة `_provisional: true`
 */
export function applyProvisionalWinner(session) {
  if (!session) return session;

  // ملاحظة مهمة: لا نخرج مبكراً عند session.locked — لأن الـ resolver بعد الحسم
  // يضع locked=true ويكتب roundEndsAt الحقيقي (clickedAt + maxTime). بدون المرور
  // من هنا سيقفز المؤقت للوراء بمقدار RTT. نستمر ونستخدم anchor المحلي بدلاً من ذلك.

  const sorted = getSortedPresses(session);
  if (sorted.length === 0) {
    if (local.provisionalAnchor?.key) {
      local.provisionalAnchor = { key: "", startedAt: 0 };
    }
    return session;
  }

  const winnerPress = sorted[0];
  const maxTime = Number(session.maxTime || 3);

  // ⚙️ الفائز الرسمي من الخادم: إذا كان مختلفاً عن محسوبنا المحلي، نثق بالخادم.
  const serverConfirmedDifferent =
    session.winnerTeamId !== null &&
    session.winnerTeamId !== undefined &&
    !session.answerExpired &&
    session.winnerPlayerId &&
    String(session.winnerPlayerId) !== String(winnerPress.deviceId);

  if (serverConfirmedDifferent) {
    return session;
  }

  // 🎯 Provisional Anchor — نُثبّت لحظة "أول مشاهدة" للضغطة على هذا الجهاز.
  // اللاعب الضاغط: anchor ≈ clickedAt (provisional يعمل فور النقرة)
  // المشرف / اللاعبون الآخرون: anchor = لحظة وصول الـ press عبر WebSocket
  //   = clickedAt + RTT/2 → يبدأ العدّ من maxTime كامل بلا تأثير الشبكة.
  const anchorKey = `${String(session.code || "")}:${Number(session.roundId || 0)}:${String(winnerPress.deviceId || "")}`;

  let anchorStartedAt =
    local.provisionalAnchor?.key === anchorKey
      ? Number(local.provisionalAnchor.startedAt || 0)
      : 0;

  if (!anchorStartedAt) {
    // anchor = لحظة أول مشاهدة على هذا الجهاز (server-time).
    // اللاعب الضاغط: ≈ clickedAt (provisional يعمل فوراً بعد النقرة)
    // المشرف/الآخرون: ≈ clickedAt + networkRTT/2 → يبدأ من maxTime كامل
    anchorStartedAt = getServerNow();
    local.provisionalAnchor = {
      key: anchorKey,
      startedAt: anchorStartedAt,
    };
  }

  return {
    ...session,
    winnerTeamId: Number(winnerPress.teamId),
    winnerPlayerId: String(winnerPress.deviceId || ""),
    winnerPlayerName: String(winnerPress.playerName || ""),
    winnerPressedAt: anchorStartedAt,
    locked: true,
    timerRunning: true,
    answerExpired: false,
    roundStartedAt: anchorStartedAt,
    roundEndsAt: anchorStartedAt + maxTime * 1000,
    timeLeft: maxTime,
    _provisional: true,
  };
}

export function getCooldownSecondsLeft(session) {
  if (!isMyCooldownActive(session)) return 0;

  const serverNow = getServerNow();

  return Math.max(
    0,
    Math.ceil((Number(session.cooldownEndsAt) - serverNow) / 1000),
  );
}

export function getPlayersByTeam(session, teamId) {
  const presenceEntries = Object.values(session.presence || {});

  return presenceEntries
    .filter((item) => Number(item?.teamId) === Number(teamId))
    .map((item) => sanitizeName(item?.name || "لاعب"))
    .filter(Boolean);
}

export function getSortedPresses(session) {
  return Object.values(session.presses || {})
    .filter(
      (press) =>
        Number(press.roundId) === Number(session.roundId) &&
        Number.isFinite(press.teamId) &&
        press.teamId > 0 &&
        typeof press.playerName === "string" &&
        Number.isFinite(press.pressedAt) &&
        press.pressedAt > 0,
    )
    .sort((a, b) => {
      if (a.pressedAt !== b.pressedAt) return a.pressedAt - b.pressedAt;
      return String(a.deviceId).localeCompare(String(b.deviceId));
    });
}

export function isResolutionLockActive(session) {
  return (
    Boolean(session?.resolutionLock?.active) &&
    Number(session?.resolutionLock?.expiresAt || 0) > getServerNow() &&
    Number(session?.resolutionLock?.roundId || 0) ===
      Number(session?.roundId || 0)
  );
}

function buildResolutionLockOwner() {
  return `host:${local.deviceId}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * يحاول أخذ قفل الحسم لجولة محددة بشكل ذري.
 *
 * قواعد القبول داخل الـ transaction:
 *  1. القفل غير نشط              → خذه
 *  2. القفل نشط لكن TTL انتهت    → استولِ عليه (self-heal)
 *  3. القفل نشط لجولة مختلفة     → استولِ عليه (stale من جولة قديمة)
 *  4. القفل نشط لنفس الجولة      → abort (resolver آخر يعمل الآن)
 *
 * @param {number} roundId الجولة المستهدفة للحسم
 * @returns {Promise<{ok: boolean, owner: string}>}
 */
export async function acquireResolutionLock(roundId) {
  if (!local.currentSessionCode) {
    return { ok: false, owner: "" };
  }

  const targetRoundId = Number(roundId || 0);
  if (!Number.isFinite(targetRoundId) || targetRoundId <= 0) {
    return { ok: false, owner: "" };
  }

  const owner = buildResolutionLockOwner();
  const now = getServerNow();
  const expiresAt = now + RESOLUTION_LOCK_TTL_MS;

  let result;
  try {
    result = await runTransaction(
      resolutionLockRef(local.currentSessionCode),
      (current) => {
        const currentActive = Boolean(current?.active);
        const currentRoundId = Number(current?.roundId || 0);
        const currentExpiresAt = Number(current?.expiresAt || 0);
        const currentStillValid = currentActive && currentExpiresAt > now;

        // قفل نشط لنفس الجولة ولم تنتهِ TTL → لا تلمسه
        if (currentStillValid && currentRoundId === targetRoundId) {
          return; // abort
        }

        // غير ذلك: خذه (جديد / مستولى من stale / من جولة قديمة)
        return {
          active: true,
          roundId: targetRoundId,
          owner,
          createdAt: now,
          expiresAt,
        };
      },
      { applyLocally: false },
    );
  } catch (error) {
    console.warn("acquireResolutionLock transaction error:", error?.message ?? error);
    return { ok: false, owner: "" };
  }

  const lockValue = result?.snapshot?.val?.();

  const acquired =
    Boolean(result?.committed) &&
    lockValue &&
    String(lockValue.owner || "") === owner &&
    Number(lockValue.roundId || 0) === targetRoundId;

  return { ok: Boolean(acquired), owner };
}

/**
 * يفك القفل بشكل آمن — يتحقق من owner و roundId قبل التصفير.
 * يضمن أن لا يفك أحد قفل غيره، ويسمح بـ short-circuit لو القفل فعلاً متصفّر.
 *
 * @param {string} owner   owner المتوقع (من acquireResolutionLock)
 * @param {number|null} roundId الجولة المتوقعة
 */
export async function releaseResolutionLock(owner = "", roundId = null) {
  if (!local.currentSessionCode) return;

  try {
    await runTransaction(
      resolutionLockRef(local.currentSessionCode),
      (current) => {
        // غير موجود → اعتبره متصفراً (idempotent)
        if (!current || typeof current !== "object") {
          return emptyResolutionLock();
        }

        // فعلاً متصفر؟ لا تلمس (تجنب كتابة شبكية عبثية)
        if (!current.active && !current.owner) {
          return; // abort
        }

        // مالك مختلف؟ ممنوع تفكه
        if (owner && String(current.owner || "") !== String(owner)) {
          return; // abort
        }

        // جولة مختلفة؟ ممنوع تفكه
        if (
          roundId !== null &&
          roundId !== undefined &&
          Number(current.roundId || 0) !== Number(roundId)
        ) {
          return; // abort
        }

        return emptyResolutionLock();
      },
      { applyLocally: false },
    );
  } catch (error) {
    console.warn("releaseResolutionLock error:", error?.message ?? error);
  }
}

/**
 * تصفير غير مشروط للقفل — يُستخدم في حالات إعادة الضبط الكلي
 * (مثلاً إنهاء الجلسة) حيث لا يهمنا من يملكه.
 */
export async function forceReleaseResolutionLock() {
  if (!local.currentSessionCode) return;
  try {
    await update(sessionRef(local.currentSessionCode), {
      resolutionLock: emptyResolutionLock(),
    });
  } catch (error) {
    console.warn("forceReleaseResolutionLock error:", error?.message ?? error);
  }
}

// ─────────────────────────────────────────────
// Session Lifecycle
// ─────────────────────────────────────────────

export async function deleteSessionIfExpired(code) {
  const snapshot = await get(sessionRef(code));
  if (!snapshot.exists()) return false;

  const data = snapshot.val();
  const expiresAt = Number(data?.expiresAt || 0);

  if (expiresAt && getServerNow() > expiresAt) {
    await set(sessionRef(code), null);
    return true;
  }

  return false;
}

export async function ensureSession(code) {
  const codeClean = String(code || "")
    .trim()
    .toUpperCase();

  if (!codeClean) {
    throw new Error("كود الجلسة فارغ");
  }

  const snapshot = await get(sessionRef(codeClean));

  if (!snapshot.exists()) {
    const serverNow = getServerNow();

    await set(sessionRef(codeClean), {
      code: codeClean,
      locked: false,
      timerRunning: false,
      answerExpired: false,
      timeLeft: 3,
      maxTime: 3,
      roundId: 1,
      forceUnlockToken: 0,
      winnerTeamId: null,
      winnerPlayerName: "",
      winnerPlayerId: "",
      winnerPressedAt: null,
      roundStartedAt: null,
      roundEndsAt: null,
      resolutionLock: emptyResolutionLock(),
      teams: defaultTeams(),
      presses: null,
      cooldown: 0,
      cooldownEndsAt: null,
      cooldownPlayerId: "",
      cooldownTeamId: null,
      createdAt: serverNow,
      updatedAt: serverNow,
      hostUpdatedAt: serverNow,
      expiresAt: serverNow + SESSION_EXPIRY_MS,
    });

    return codeClean;
  }

  const current = snapshot.val() || {};
  const patch = {};

  if (!Array.isArray(current.teams) || current.teams.length === 0) {
    patch.teams = defaultTeams();
  }

  if (!Number.isFinite(Number(current.maxTime))) {
    patch.maxTime = 3;
  }

  if (!Number.isFinite(Number(current.timeLeft))) {
    patch.timeLeft = Number.isFinite(Number(current.maxTime))
      ? Number(current.maxTime)
      : 3;
  }

  if (!Number.isFinite(Number(current.cooldown))) {
    patch.cooldown = 0;
  }

  if (!Number.isFinite(Number(current.roundId))) {
    patch.roundId = 1;
  }

  if (!Number.isFinite(Number(current.forceUnlockToken))) {
    patch.forceUnlockToken = 0;
  }

  if (!current.resolutionLock || typeof current.resolutionLock !== "object") {
    patch.resolutionLock = emptyResolutionLock();
  }

  if (
    current.cooldownTeamId !== null &&
    current.cooldownTeamId !== undefined &&
    !Number.isFinite(Number(current.cooldownTeamId))
  ) {
    patch.cooldownTeamId = null;
  }

  if (Object.keys(patch).length > 0) {
    const serverNow = getServerNow();
    patch.updatedAt = serverNow;
    patch.expiresAt = serverNow + SESSION_EXPIRY_MS;
    await update(sessionRef(codeClean), patch);
  }

  return codeClean;
}

export async function refreshSessionExpiry() {
  if (!local.currentSessionCode) return;

  const serverNow = getServerNow();

  await update(sessionRef(local.currentSessionCode), {
    expiresAt: serverNow + SESSION_EXPIRY_MS,
    updatedAt: serverNow,
  });
}

export async function readCurrentSession() {
  if (!local.currentSessionCode) {
    throw new Error("لا توجد جلسة حالية");
  }

  const snapshot = await get(sessionRef(local.currentSessionCode));

  if (!snapshot.exists()) {
    throw new Error("الجلسة غير موجودة");
  }

  return normalizeSession(snapshot.val(), local.currentSessionCode);
}

export async function updateSessionPatch(patch) {
  if (!local.currentSessionCode) {
    throw new Error("لا توجد جلسة حالية");
  }

  const serverNow = getServerNow();

  await update(sessionRef(local.currentSessionCode), {
    ...patch,
    updatedAt: serverNow,
    expiresAt: serverNow + SESSION_EXPIRY_MS,
  });
}

/**
 * يُعيد ضبط الجولة من جذورها.
 * يستخدم session.maxTime فقط (بيانات الخادم) — لا يعتمد على DOM.
 */
export async function resetToFreshRound(session, extraPatch = {}) {
  await updateSessionPatch({
    winnerTeamId: null,
    winnerPlayerName: "",
    winnerPlayerId: "",
    winnerPressedAt: null,
    locked: false,
    timerRunning: false,
    answerExpired: false,
    roundStartedAt: null,
    roundEndsAt: null,
    roundId: Number(session.roundId || 1) + 1,
    presses: null,
    timeLeft: Number(session.maxTime) || 3,
    resolutionLock: emptyResolutionLock(),
    ...extraPatch,
    hostUpdatedAt: getServerNow(),
  });
}

export async function toggleLock() {
  const session = await readCurrentSession();

  await updateSessionPatch({
    locked: !session.locked,
    hostUpdatedAt: getServerNow(),
  });
}

export async function clearWinner() {
  const session = await readCurrentSession();

  await resetToFreshRound(session, {
    cooldownEndsAt: null,
    cooldownPlayerId: "",
    cooldownTeamId: null,
  });
}

export async function openAllForPlayers() {
  const session = await readCurrentSession();

  await resetToFreshRound(session, {
    cooldownEndsAt: null,
    cooldownPlayerId: "",
    cooldownTeamId: null,
    forceUnlockToken: Number(session.forceUnlockToken || 0) + 1,
  });
}

// ─────────────────────────────────────────────
// Claim Buzz — Player-side (new architecture)
// ─────────────────────────────────────────────

/**
 * يُسجّل ضغطة اللاعب في /presses/{deviceId} بكتابة واحدة فقط.
 *
 * ⚡ تصميم زمني:
 *   - pressedAt يُمرَّر صريحاً من لحظة النقر الفعلية (getServerNow() في click handler).
 *     هذا يضمن أن roundEndsAt = pressedAt + maxTime*1000 يعكس "لحظة الضغط" بدقة
 *     — لا يتأثر بتأخير الشبكة أو الـ JS execution.
 *   - لا get() قبل الكتابة. الـ host resolver هو مصدر الحقيقة ويتحقق من كل القيود
 *     داخل transaction ذرية (locked, winner, cooldown, round mismatch).
 *   - الفحوص المحلية (canBuzz/getBuzzBlockReason) في click handler تمنع الطلبات
 *     العبثية قبل الوصول إلى هنا.
 *
 * @param {number} teamId
 * @param {string} playerName
 * @param {number} expectedRoundId
 * @param {number} pressedAt   timestamp بالميلي ثانية (server-time)
 * @returns {Promise<boolean>}
 */
export async function claimBuzz(
  teamId,
  playerName = "",
  expectedRoundId,
  pressedAt,
) {
  if (!local.currentSessionCode) return false;

  const teamIdNum = Number(teamId);
  if (!Number.isFinite(teamIdNum)) return false;

  const safePressedAt = Number.isFinite(Number(pressedAt))
    ? Number(pressedAt)
    : getServerNow();
  const roundId = Number.isFinite(Number(expectedRoundId))
    ? Number(expectedRoundId)
    : 1;
  const safePlayerName = sanitizeName(playerName) || "لاعب";

  try {
    await update(sessionRef(local.currentSessionCode), {
      [`presses/${local.deviceId}`]: {
        teamId: teamIdNum,
        playerName: safePlayerName,
        pressedAt: safePressedAt,
        roundId,
      },
      updatedAt: safePressedAt,
      expiresAt: safePressedAt + SESSION_EXPIRY_MS,
    });

    return true;
  } catch (error) {
    console.warn("claimBuzz error:", error?.message ?? error);
    return false;
  }
}

// ─────────────────────────────────────────────
// Resolve Winner — Host-side
// ─────────────────────────────────────────────

/**
 * يحسم الجولة: يختار الأسبق ضغطاً ويكتبه كفائز.
 *
 * تسلسل الحماية (من الأرخص للأغلى):
 *  1. فحص حالة الـ session المُمرَّرة (تفادي transaction بلا داعي)
 *  2. أخذ قفل ذري لـ roundId المحدد
 *  3. إعادة قراءة الـ session بعد القفل (guards ضد race بين الفحص والقفل)
 *  4. كتابة الفائز + تصفير القفل inline (atomic) في نفس الـ update
 *  5. finally: release شرطي (فقط لو لم نُصفّره inline)
 */
export async function resolvePressesToWinner(session) {
  if (!local.currentSessionCode) return false;

  // guards رخيصة قبل أي نداء شبكي
  if (session.locked) return false;
  if (session.winnerTeamId !== null && !session.answerExpired) return false;

  const sortedPresses = getSortedPresses(session);
  if (sortedPresses.length === 0) return false;

  const targetRoundId = Number(session.roundId || 1);
  const lock = await acquireResolutionLock(targetRoundId);
  if (!lock.ok) {
    return false;
  }

  // إذا صفّرنا القفل inline مع كتابة الفائز، نتخطى release في finally.
  let lockClearedInline = false;

  try {
    const freshSession = await readCurrentSession();

    // الجولة تغيّرت بين القراءة الأولى والقفل → تخلَّ بصمت
    if (Number(freshSession.roundId || 0) !== targetRoundId) return false;
    if (freshSession.locked) return false;
    if (freshSession.winnerTeamId !== null && !freshSession.answerExpired) return false;

    const freshPresses = getSortedPresses(freshSession);
    if (freshPresses.length === 0) return false;

    const winnerPress = freshPresses[0];
    const maxTime = Number(freshSession.maxTime || 3);
    const winnerTime = Number(winnerPress.pressedAt);
    const serverNow = getServerNow();

    // كتابة ذرية واحدة: الفائز + تصفير القفل معاً
    await update(sessionRef(local.currentSessionCode), {
      winnerTeamId: Number(winnerPress.teamId),
      winnerPlayerName: String(winnerPress.playerName || ""),
      winnerPlayerId: String(winnerPress.deviceId || ""),
      winnerPressedAt: winnerTime,
      locked: true,
      timerRunning: true,
      answerExpired: false,
      roundStartedAt: winnerTime,
      roundEndsAt: winnerTime + maxTime * 1000,
      timeLeft: maxTime,
      cooldownPlayerId: "",
      cooldownTeamId: null,
      cooldownEndsAt: null,
      resolutionLock: emptyResolutionLock(),
      updatedAt: serverNow,
      hostUpdatedAt: serverNow,
      expiresAt: serverNow + SESSION_EXPIRY_MS,
    });

    lockClearedInline = true;

    console.log(
      `resolvePressesToWinner: winner = ${winnerPress.playerName} (team ${winnerPress.teamId}) at ${winnerTime}`,
    );

    return true;
  } catch (error) {
    console.warn("resolvePressesToWinner error:", error?.message ?? error);
    return false;
  } finally {
    // إذا لم نُصفّر inline (فشل في مكان ما) نفك القفل المأخوذ.
    // مع ذلك TTL سيتكفل بالباقي كـ safety net إذا فشل حتى الـ release.
    if (!lockClearedInline) {
      await releaseResolutionLock(lock.owner, targetRoundId);
    }
  }
}

// ─────────────────────────────────────────────
// Legacy registerPress (للتوافق — غير مستخدمة حالياً)
// ─────────────────────────────────────────────

export async function registerPress(teamId, playerName = "") {
  if (!local.currentSessionCode) return false;

  const safePlayerName = sanitizeName(playerName) || "لاعب";
  const teamIdNum = Number(teamId);

  if (!Number.isFinite(teamIdNum)) return false;

  const serverNow = getServerNow();
  const currentSession = await readCurrentSession();

  await update(sessionRef(local.currentSessionCode), {
    [`presses/${local.deviceId}`]: {
      teamId: teamIdNum,
      playerName: safePlayerName,
      pressedAt: serverNow,
      roundId: Number(currentSession.roundId || 1),
    },
    updatedAt: serverNow,
    expiresAt: serverNow + SESSION_EXPIRY_MS,
  });

  return true;
}

// ─────────────────────────────────────────────
// Team & Points Operations
// ─────────────────────────────────────────────

export async function addPoint() {
  const session = await readCurrentSession();
  if (session.winnerTeamId == null) return;

  const teams = session.teams.map((team) =>
    team.id === session.winnerTeamId
      ? { ...team, points: Number(team.points || 0) + 1 }
      : team,
  );

  await resetToFreshRound(session, {
    teams,
    cooldownEndsAt: null,
    cooldownPlayerId: "",
    cooldownTeamId: null,
  });
}

export async function changeTeamPoints(teamId, amount) {
  const session = await readCurrentSession();

  const teams = session.teams.map((team) =>
    team.id === teamId
      ? { ...team, points: Math.max(0, Number(team.points || 0) + amount) }
      : team,
  );

  await updateSessionPatch({
    teams,
    hostUpdatedAt: getServerNow(),
  });
}

export async function addTeam() {
  const session = await readCurrentSession();
  const nextId = Number(crypto.getRandomValues(new Uint32Array(1))[0]);

  const usedColors = session.teams.map((team) => team.colorClass);
  const availableColors = TEAM_COLORS.filter(
    (color) => !usedColors.includes(color),
  );

  const colorClass =
    availableColors.length > 0
      ? availableColors[0]
      : TEAM_COLORS[session.teams.length % TEAM_COLORS.length];

  const autoName = getTeamDisplayNameByColor(colorClass);

  const teams = [
    ...session.teams,
    { id: nextId, name: autoName, colorClass, points: 0 },
  ];

  await updateSessionPatch({
    teams,
    hostUpdatedAt: getServerNow(),
  });

  return autoName;
}

export async function removeTeam(teamId) {
  const session = await readCurrentSession();

  if (session.teams.length <= 1) {
    throw new Error("لا يمكن حذف آخر فريق");
  }

  const teams = session.teams.filter((team) => team.id !== teamId);
  const patch = {
    teams,
    hostUpdatedAt: getServerNow(),
  };

  if (session.winnerTeamId === teamId) {
    patch.winnerTeamId = null;
    patch.winnerPlayerName = "";
    patch.winnerPlayerId = "";
    patch.winnerPressedAt = null;
    patch.locked = false;
    patch.timerRunning = false;
    patch.answerExpired = false;
    patch.roundStartedAt = null;
    patch.roundEndsAt = null;
    patch.roundId = Number(session.roundId || 1) + 1;
    patch.presses = null;
    patch.timeLeft = session.maxTime || 3;
    patch.resolutionLock = emptyResolutionLock();
  }

  if (Number(session.cooldownTeamId) === Number(teamId)) {
    patch.cooldownTeamId = null;
    patch.cooldownPlayerId = "";
    patch.cooldownEndsAt = null;
  }

  await updateSessionPatch(patch);
}

export async function updateTeamName(teamId, name) {
  const safeName = sanitizeName(name);
  if (!safeName) return;

  const session = await readCurrentSession();

  const teams = session.teams.map((team) =>
    team.id === teamId ? { ...team, name: safeName } : team,
  );

  await updateSessionPatch({
    teams,
    hostUpdatedAt: getServerNow(),
  });
}