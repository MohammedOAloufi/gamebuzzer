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
 *   - عند وصول أول press في جولة، يختار الأسبق ويكتبه كـ winner
 *   - يضبط locked, timerRunning, roundEndsAt الخ
 *
 * هذا يلغي race conditions بين اللاعبين ويزيل مشكلة
 * "message channel closed" و stale transactions.
 */

import { db, ref, set, update, get } from "./firebase.js";
import {
  TEAM_COLORS,
  SESSION_EXPIRY_MS,
  local,
  getServerNow,
} from "./state.js";
import { sanitizeName, getTeamDisplayNameByColor } from "./utils.js";
import { els } from "./dom.js";

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
    raw?.presses && typeof raw.presses === "object" ? raw.presses : {};

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
    presence:
      raw?.presence && typeof raw.presence === "object" ? raw.presence : {},
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
  const roundExpired = hasRoundExpired(session);
  const effectiveLocked = Boolean(session.locked) && !roundExpired;
  const effectiveAnswerExpired = Boolean(session.answerExpired) || roundExpired;

  if (!local.joinedPlayer) return "join_required";
  if (effectiveLocked) return "round_locked";
  if (isMyCooldownActive(session)) return "team_cooldown";

  if (session.winnerTeamId !== null && !effectiveAnswerExpired) {
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

export function hasRoundExpired(sessionLike) {
  const roundEndsAt = Number(sessionLike?.roundEndsAt || 0);
  if (!roundEndsAt) return false;
  return getServerNow() >= roundEndsAt;
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
    forceUnlockToken: Number(session.forceUnlockToken || 0) + 1,
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
  });
}

// ─────────────────────────────────────────────
// Claim Buzz — Player-side (new architecture)
// ─────────────────────────────────────────────

/**
 * claimBuzz — إصدار المعمارية الجديدة
 *
 * اللاعب يكتب press في مكانه فقط: sessions/{code}/presses/{deviceId}
 * لا يلمس winnerTeamId أو locked — المشرف يقرر الفائز.
 *
 * مزايا:
 * ─────
 * - كتابة واحدة بسيطة، لا transactions
 * - لا تعارض بين اللاعبين — كل واحد يكتب في مكانه
 * - لا WebSocket closes، لا retry loops
 * - لو ضغط لاعبان في نفس اللحظة، كلاهما يُسجَّل والمشرف يختار الأسبق
 *
 * @param {number} teamId - معرّف الفريق
 * @param {string} playerName - اسم اللاعب
 * @param {number} expectedRoundId - الجولة المتوقعة (للتحقق)
 * @returns {Promise<boolean>} - true إذا كُتب الـ press بنجاح
 */
export async function claimBuzz(teamId, playerName = "", expectedRoundId) {
  if (!local.currentSessionCode) return false;

  const safePlayerName = sanitizeName(playerName) || "لاعب";
  const teamIdNum = Number(teamId);

  if (!Number.isFinite(teamIdNum)) return false;

  try {
    // ─── 1. اقرأ الحالة الحالية للتحقق المحلي ───
    const snapshot = await get(sessionRef(local.currentSessionCode));
    if (!snapshot.exists()) return false;

    const current = snapshot.val();
    const attemptTime = getServerNow();
    const roundExpired =
      Boolean(current?.roundEndsAt) &&
      attemptTime >= Number(current.roundEndsAt);

    // ─── 2. تحقّق من expectedRoundId ───
    const roundId = Number(current.roundId || 1);
    if (
      expectedRoundId !== undefined &&
      Number.isFinite(expectedRoundId) &&
      roundId !== expectedRoundId
    ) {
      console.log(
        `claimBuzz: round changed (${expectedRoundId} → ${roundId}) — aborting`,
      );
      return false;
    }

    // ─── 3. تحقّق من القفل والفائز الحالي ───
    const locked = Boolean(current.locked) && !roundExpired;
    const answerExpired = Boolean(current.answerExpired) || roundExpired;
    const currentWinner =
      current.winnerTeamId === null || current.winnerTeamId === undefined
        ? null
        : Number(current.winnerTeamId);

    if (locked || (currentWinner !== null && !answerExpired)) {
      return false;
    }

    // ─── 3.5. self-heal لو الوقت انتهى لكن المشرف لم يحدّث الجلسة بعد ───
    if (roundExpired && currentWinner !== null) {
      await update(sessionRef(local.currentSessionCode), {
        timeLeft: 0,
        timerRunning: false,
        answerExpired: true,
        roundEndsAt: null,
        roundStartedAt: null,
        locked: false,
        forceUnlockToken: Number(current.forceUnlockToken || 0) + 1,
        presses: null,
        updatedAt: attemptTime,
        expiresAt: attemptTime + SESSION_EXPIRY_MS,
      });

      return false;
    }

    // ─── 4. تحقّق من cooldown ───
    const cooldownTeamId =
      current.cooldownTeamId === null || current.cooldownTeamId === undefined
        ? null
        : Number(current.cooldownTeamId);
    const cooldownEndsAt = current.cooldownEndsAt ?? null;

    const myTeamCooldownActive =
      cooldownTeamId !== null &&
      cooldownTeamId === teamIdNum &&
      Boolean(cooldownEndsAt) &&
      attemptTime < Number(cooldownEndsAt);

    if (myTeamCooldownActive) return false;

    // ─── 5. تحقّق من press سابقة في هذه الجولة ───
    const currentPresses =
      current.presses && typeof current.presses === "object"
        ? current.presses
        : {};
    const myCurrentPress = currentPresses[local.deviceId];
    const alreadyPressedThisRound =
      myCurrentPress &&
      Number(myCurrentPress.roundId || 0) === Number(roundId);

    if (alreadyPressedThisRound) return false;

    // ─── 6. اكتب press فقط — لا تلمس winner أو locked ───
    // كتابة atomic على node منفصل — لا تعارض مع كتابات لاعبين آخرين
    await update(sessionRef(local.currentSessionCode), {
      [`presses/${local.deviceId}`]: {
        teamId: teamIdNum,
        playerName: safePlayerName,
        pressedAt: attemptTime,
        roundId,
      },
      updatedAt: attemptTime,
      expiresAt: attemptTime + SESSION_EXPIRY_MS,
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
 * resolvePressesToWinner — يستدعيه المشرف عند تغيّر الـ presses.
 *
 * المشرف يقرر الفائز بناءً على الأسبق في pressedAt.
 * يُستدعى من host-controller عبر onValue على pressesRef.
 *
 * @param {Object} session - الجلسة الحالية (normalized)
 * @returns {Promise<boolean>} - true إذا تم تعيين فائز جديد
 */
export async function resolvePressesToWinner(session) {
  if (!local.currentSessionCode) return false;

  // لا نحتاج حل الفائز إذا كان موجود أصلاً ولم ينتهِ وقته
  if (session.winnerTeamId !== null && !session.answerExpired) {
    return false;
  }

  // لا نحل الفائز إذا كانت الجلسة مقفلة
  if (session.locked) return false;

  // أول press حسب الوقت (ثم deviceId لـ tie-breaking)
  const sortedPresses = getSortedPresses(session);
  if (sortedPresses.length === 0) return false;

  const winnerPress = sortedPresses[0];
  const maxTime = Number(session.maxTime || 3);
  const winnerTime = Number(winnerPress.pressedAt);
  const serverNow = getServerNow();

  try {
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
      updatedAt: serverNow,
      hostUpdatedAt: serverNow,
      expiresAt: serverNow + SESSION_EXPIRY_MS,
    });

    console.log(
      `resolvePressesToWinner: winner = ${winnerPress.playerName} (team ${winnerPress.teamId}) at ${winnerTime}`,
    );

    return true;
  } catch (error) {
    console.warn("resolvePressesToWinner error:", error?.message ?? error);
    return false;
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
    patch.forceUnlockToken = Number(session.forceUnlockToken || 0) + 1;
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