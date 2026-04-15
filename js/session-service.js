import { db, ref, set, update, get, runTransaction } from "./firebase.js";
import { TEAM_COLORS, SESSION_EXPIRY_MS, local } from "./state.js";
import { sanitizeName, getTeamDisplayNameByColor } from "./utils.js";
import { els } from "./dom.js";

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

  return (
    Number.isFinite(selectedTeamId) &&
    session.cooldownTeamId !== null &&
    Number(session.cooldownTeamId) === Number(selectedTeamId) &&
    Boolean(session.cooldownEndsAt) &&
    Date.now() < Number(session.cooldownEndsAt)
  );
}

export function hasMyPressInCurrentRound(session) {
  const myPress = session.presses?.[local.deviceId];
  return Boolean(
    myPress && Number(myPress.roundId) === Number(session.roundId),
  );
}

export function canBuzz(session) {
  return (
    local.joinedPlayer &&
    !session.locked &&
    (session.winnerTeamId === null || session.answerExpired) &&
    !isMyCooldownActive(session) &&
    !hasMyPressInCurrentRound(session)
  );
}

export function getCooldownSecondsLeft(session) {
  if (!isMyCooldownActive(session)) return 0;

  return Math.max(
    0,
    Math.ceil((Number(session.cooldownEndsAt) - Date.now()) / 1000),
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

export async function deleteSessionIfExpired(code) {
  const snapshot = await get(sessionRef(code));
  if (!snapshot.exists()) return false;

  const data = snapshot.val();
  const expiresAt = Number(data?.expiresAt || 0);

  if (expiresAt && Date.now() > expiresAt) {
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
    await set(sessionRef(codeClean), {
      code: codeClean,
      locked: false,
      timerRunning: false,
      answerExpired: false,
      timeLeft: 3,
      maxTime: 3,
      roundId: 1,
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
      hostUpdatedAt: Date.now(),
      expiresAt: Date.now() + SESSION_EXPIRY_MS,
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

  if (
    current.cooldownTeamId !== null &&
    current.cooldownTeamId !== undefined &&
    !Number.isFinite(Number(current.cooldownTeamId))
  ) {
    patch.cooldownTeamId = null;
  }

  if (Object.keys(patch).length > 0) {
    patch.updatedAt = Date.now();
    patch.expiresAt = Date.now() + SESSION_EXPIRY_MS;
    await update(sessionRef(codeClean), patch);
  }

  return codeClean;
}

export async function refreshSessionExpiry() {
  if (!local.currentSessionCode) return;

  await update(sessionRef(local.currentSessionCode), {
    expiresAt: Date.now() + SESSION_EXPIRY_MS,
    updatedAt: Date.now(),
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

  await update(sessionRef(local.currentSessionCode), {
    ...patch,
    updatedAt: Date.now(),
    expiresAt: Date.now() + SESSION_EXPIRY_MS,
  });
}

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
    timeLeft: session.maxTime || Number(els.timeSelector?.value || 3),
    ...extraPatch,
    hostUpdatedAt: Date.now(),
  });
}

export async function toggleLock() {
  const session = await readCurrentSession();

  await updateSessionPatch({
    locked: !session.locked,
    hostUpdatedAt: Date.now(),
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

export async function registerPress(teamId, playerName = "") {
  if (!local.currentSessionCode) return false;

  const safePlayerName = sanitizeName(playerName) || "لاعب";
  const teamIdNum = Number(teamId);

  if (!Number.isFinite(teamIdNum)) return false;

  await update(sessionRef(local.currentSessionCode), {
    [`presses/${local.deviceId}`]: {
      teamId: teamIdNum,
      playerName: safePlayerName,
      pressedAt: Date.now(),
      roundId: Number((await readCurrentSession()).roundId || 1),
    },
    updatedAt: Date.now(),
    expiresAt: Date.now() + SESSION_EXPIRY_MS,
  });

  return true;
}

export async function claimBuzz(teamId, playerName = "") {
  if (!local.currentSessionCode) return false;

  const session = await readCurrentSession();

  if (
    session.locked ||
    (session.winnerTeamId !== null && !session.answerExpired) ||
    isMyCooldownActive(session) ||
    hasMyPressInCurrentRound(session)
  ) {
    return false;
  }

  const safePlayerName = sanitizeName(playerName) || "لاعب";
  const teamIdNum = Number(teamId);

  if (!Number.isFinite(teamIdNum)) return false;

  const result = await runTransaction(
    sessionRef(local.currentSessionCode),
    (current) => {
      if (!current) return current;

      const currentWinner =
        current.winnerTeamId === null || current.winnerTeamId === undefined
          ? null
          : Number(current.winnerTeamId);

      const locked = Boolean(current.locked);
      const answerExpired = Boolean(current.answerExpired);
      const roundId = Number(current.roundId || 1);
      const cooldownTeamId =
        current.cooldownTeamId === null || current.cooldownTeamId === undefined
          ? null
          : Number(current.cooldownTeamId);
      const cooldownEndsAt = current.cooldownEndsAt ?? null;

      const myTeamCooldownActive =
        cooldownTeamId !== null &&
        cooldownTeamId === teamIdNum &&
        Boolean(cooldownEndsAt) &&
        Date.now() < Number(cooldownEndsAt);

      if (
        locked ||
        (currentWinner !== null && !answerExpired) ||
        myTeamCooldownActive
      ) {
        return;
      }

      const now = Date.now();
      const maxTime = Number(current.maxTime || 3);
      const nextPresses =
        current.presses && typeof current.presses === "object"
          ? { ...current.presses }
          : {};

      nextPresses[local.deviceId] = {
        teamId: teamIdNum,
        playerName: safePlayerName,
        pressedAt: now,
        roundId,
      };

      return {
        ...current,
        winnerTeamId: teamIdNum,
        winnerPlayerName: safePlayerName,
        winnerPlayerId: local.deviceId,
        winnerPressedAt: now,
        locked: true,
        timerRunning: false,
        answerExpired: false,
        roundStartedAt: null,
        roundEndsAt: null,
        timeLeft: maxTime,
        cooldownPlayerId: "",
        cooldownTeamId: null,
        cooldownEndsAt: null,
        updatedAt: now,
        hostUpdatedAt: now,
        expiresAt: now + SESSION_EXPIRY_MS,
        presses: nextPresses,
      };
    },
    {
      applyLocally: false,
    },
  );

  return result.committed === true;
}

export async function resolveWinnerFromPresses() {
  return;
}

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
    hostUpdatedAt: Date.now(),
  });
}

export async function addTeam() {
  const session = await readCurrentSession();
  const nextId = Date.now();

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
    {
      id: nextId,
      name: autoName,
      colorClass,
      points: 0,
    },
  ];

  await updateSessionPatch({
    teams,
    hostUpdatedAt: Date.now(),
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
    hostUpdatedAt: Date.now(),
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
    hostUpdatedAt: Date.now(),
  });
}