import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  get,
  runTransaction,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBMY5kBb_UIV8jpDM2Pj8cm-3aKg78VnC0",
  authDomain: "gamebuzzuer.firebaseapp.com",
  databaseURL:
    "https://gamebuzzuer-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gamebuzzuer",
  storageBucket: "gamebuzzuer.firebasestorage.app",
  messagingSenderId: "952611711946",
  appId: "1:952611711946:web:881006b2fa17693307bd33",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const TEAM_COLORS = [
  "team-red",
  "team-blue",
  "team-green",
  "team-purple",
  "team-slate",
];

const pageType = (() => {
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith("/host.html") || path.includes("host.html")) return "host";
  if (path.endsWith("/player.html") || path.includes("player.html"))
    return "player";
  return "home";
})();

const local = {
  currentSessionCode: "",
  unsubscribeSession: null,
  deviceId: crypto.randomUUID
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  joinedPlayer: false,
  lastSession: null,
  uiTickerStarted: false,
};

const els = {
  sessionCode: document.getElementById("sessionCode"),
  deviceSessionCode: document.getElementById("deviceSessionCode"),
  miniSessionCode: document.getElementById("miniSessionCode"),
  createSessionBtn: document.getElementById("createSessionBtn"),
  copyCodeBtn: document.getElementById("copyCodeBtn"),
  copyJoinBtn: document.getElementById("copyJoinBtn"),
  joinUrlText: document.getElementById("joinUrlText"),
  qrcode: document.getElementById("qrcode"),

  timeLeftText: document.getElementById("timeLeftText"),
  timerBig: document.getElementById("timerBig"),
  progressBar: document.getElementById("progressBar"),
  lockStatusBadge: document.getElementById("lockStatusBadge"),
  timerStatusBadge: document.getElementById("timerStatusBadge"),
  toggleTimerBtn: document.getElementById("toggleTimerBtn"),
  toggleLockBtn: document.getElementById("toggleLockBtn"),
  clearWinnerBtn: document.getElementById("clearWinnerBtn"),
  openAllBtn: document.getElementById("openAllBtn"),

  winnerEmpty: document.getElementById("winnerEmpty"),
  winnerBox: document.getElementById("winnerBox"),
  winnerName: document.getElementById("winnerName"),
  winnerTeamText: document.getElementById("winnerTeamText"),
  addPointBtn: document.getElementById("addPointBtn"),
  removePointBtn: document.getElementById("removePointBtn"),

  hostBuzzGrid: document.getElementById("hostBuzzGrid"),
  teamManageList: document.getElementById("teamManageList"),
  newTeamName: document.getElementById("newTeamName"),
  addTeamBtn: document.getElementById("addTeamBtn"),

  selectedTeam: document.getElementById("selectedTeam"),
  deviceName: document.getElementById("deviceName"),
  deviceBuzzBtn: document.getElementById("deviceBuzzBtn"),
  deviceTeamName: document.getElementById("deviceTeamName"),
  connectionBadge: document.getElementById("connectionBadge"),
  answerTimeBig: document.getElementById("answerTimeBig"),
  cooldownTimeLeft: document.getElementById("cooldownTimeLeft"),

  joinView: document.getElementById("joinView"),
  buzzerView: document.getElementById("buzzerView"),
  joinPlayerBtn: document.getElementById("joinPlayerBtn"),

  timeSelector: document.getElementById("timeSelector"),
  cooldownSelector: document.getElementById("cooldownSelector"),

  toast: document.getElementById("toast"),
};

function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function defaultTeams() {
  return [
    { id: 1, name: "الفريق الأحمر", colorClass: "team-red", points: 0 },
    { id: 2, name: "الفريق الأزرق", colorClass: "team-blue", points: 0 },
    { id: 3, name: "الفريق الأخضر", colorClass: "team-green", points: 0 },
    { id: 4, name: "الفريق البنفسجي", colorClass: "team-purple", points: 0 },
  ];
}

function sessionRef(code) {
  return ref(db, `sessions/${code}`);
}

function presenceRef(code) {
  return ref(db, `sessions/${code}/presence/${local.deviceId}`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeName(value) {
  const clean = String(value || "")
    .replace(/[<>]/g, "")
    .trim();
  return clean.slice(0, 40);
}

function showToast(message, isError = false) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.style.background = isError ? "#dc2626" : "#10b981";
  els.toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    els.toast.classList.remove("show");
  }, 1800);
}

function getBaseUrl() {
  return `${window.location.origin}${window.location.pathname.replace(
    /[^/]+$/,
    "",
  )}`;
}

function getPlayerJoinUrl(code = local.currentSessionCode) {
  return `${getBaseUrl()}player.html?session=${encodeURIComponent(code)}`;
}

function updateQRCode(code = local.currentSessionCode) {
  if (!els.qrcode || typeof QRCode === "undefined") return;
  els.qrcode.innerHTML = "";
  new QRCode(els.qrcode, {
    text: getPlayerJoinUrl(code),
    width: 132,
    height: 132,
    colorDark: "#111827",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H,
  });
}

function normalizeSession(raw, code) {
  const safeTeams =
    Array.isArray(raw?.teams) && raw.teams.length > 0
      ? raw.teams
      : defaultTeams();

  const parsedTimeLeft = Number(raw?.timeLeft);
  const parsedMaxTime = Number(raw?.maxTime);
  const parsedCooldown = Number(raw?.cooldown);

  return {
    code,
    locked: Boolean(raw?.locked),
    timerRunning: Boolean(raw?.timerRunning),
    timeLeft: Number.isFinite(parsedTimeLeft) ? parsedTimeLeft : 3,
    maxTime: Number.isFinite(parsedMaxTime) ? parsedMaxTime : 3,
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
    cooldown: Number.isFinite(parsedCooldown) ? parsedCooldown : 3,
    cooldownEndsAt: raw?.cooldownEndsAt ?? null,
    cooldownPlayerId: String(raw?.cooldownPlayerId || ""),
    teams: safeTeams.map((team) => ({
      id: Number(team.id),
      name: String(team.name || "فريق"),
      colorClass: String(team.colorClass || "team-slate"),
      points: Number(team.points || 0),
    })),
  };
}

function getWinnerTeam(session) {
  return session.teams.find((team) => team.id === session.winnerTeamId) || null;
}

function getSelectedTeamId() {
  if (!els.selectedTeam) return null;
  return Number(els.selectedTeam.value);
}

function getSelectedTeam(session) {
  const selectedId = getSelectedTeamId();
  return session.teams.find((team) => team.id === selectedId) || null;
}

function getCurrentPlayerName() {
  return sanitizeName(els.deviceName?.value) || "لاعب";
}

function isMyCooldownActive(session) {
  return (
    Boolean(session.cooldownPlayerId) &&
    session.cooldownPlayerId === local.deviceId &&
    Boolean(session.cooldownEndsAt) &&
    Date.now() < Number(session.cooldownEndsAt)
  );
}

function canBuzz(session) {
  return (
    local.joinedPlayer &&
    !session.locked &&
    session.winnerTeamId === null &&
    session.timeLeft > 0 &&
    !isMyCooldownActive(session)
  );
}

function getCooldownSecondsLeft(session) {
  if (!isMyCooldownActive(session)) return 0;
  return Math.max(
    0,
    Math.ceil((Number(session.cooldownEndsAt) - Date.now()) / 1000),
  );
}

function showPlayerJoinView() {
  if (els.joinView) els.joinView.classList.remove("hidden");
  if (els.buzzerView) els.buzzerView.classList.add("hidden");
}

function showPlayerBuzzerView() {
  if (els.joinView) els.joinView.classList.add("hidden");
  if (els.buzzerView) els.buzzerView.classList.remove("hidden");
}

function savePlayerDraft() {
  try {
    const payload = {
      name: sanitizeName(els.deviceName?.value),
      teamId: getSelectedTeamId(),
    };
    localStorage.setItem("gb_player_profile", JSON.stringify(payload));
  } catch (error) {
    console.error(error);
  }
}

function loadPlayerDraft() {
  try {
    const raw = localStorage.getItem("gb_player_profile");
    if (!raw) return;
    const data = JSON.parse(raw);
    if (els.deviceName && data?.name) els.deviceName.value = String(data.name);
  } catch (error) {
    console.error(error);
  }
}

function startUiTicker() {
  if (local.uiTickerStarted) return;
  local.uiTickerStarted = true;

  setInterval(() => {
    if (!local.lastSession) return;

    const session = normalizeSession(
      local.lastSession,
      local.currentSessionCode,
    );

    if (
      session.cooldownPlayerId &&
      session.cooldownEndsAt &&
      Date.now() >= Number(session.cooldownEndsAt)
    ) {
      session.cooldownPlayerId = "";
      session.cooldownEndsAt = null;
    }

    renderSession(session);
  }, 250);
}

async function syncHostSettings() {
  if (pageType !== "host" || !local.currentSessionCode) return;

  try {
    const session = await readCurrentSession();
    const newMaxTime = Number(els.timeSelector?.value || 3);
    const newCooldown = Number(els.cooldownSelector?.value || 3);

    const patch = {
      maxTime: newMaxTime,
      cooldown: newCooldown,
      hostUpdatedAt: Date.now(),
    };

    if (!session.timerRunning && session.winnerTeamId === null) {
      patch.timeLeft = newMaxTime;
    }

    await updateSessionPatch(patch);
  } catch (error) {
    console.error(error);
  }
}

function renderSession(session) {
  if (els.sessionCode) els.sessionCode.textContent = session.code;
  if (els.deviceSessionCode) els.deviceSessionCode.textContent = session.code;
  if (els.miniSessionCode) els.miniSessionCode.textContent = session.code;
  if (els.joinUrlText)
    els.joinUrlText.textContent = getPlayerJoinUrl(session.code);

  updateQRCode(session.code);

  const progress =
    session.maxTime > 0 ? (session.timeLeft / session.maxTime) * 100 : 0;

  if (els.timeLeftText) els.timeLeftText.textContent = String(session.timeLeft);
  if (els.timerBig) els.timerBig.textContent = String(session.timeLeft);
  if (els.answerTimeBig)
    els.answerTimeBig.textContent = String(session.timeLeft);
  if (els.cooldownTimeLeft) {
    els.cooldownTimeLeft.textContent = String(getCooldownSecondsLeft(session));
  }

  if (els.progressBar) {
    els.progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }

  if (els.timerStatusBadge) {
    els.timerStatusBadge.textContent = session.timerRunning
      ? "الوقت يعمل"
      : "متوقف";
    els.timerStatusBadge.className = `state-badge ${
      session.timerRunning ? "green" : ""
    }`.trim();
  }

  if (els.toggleTimerBtn) {
    els.toggleTimerBtn.textContent = session.timerRunning
      ? "إيقاف المؤقت"
      : "تشغيل المؤقت";
  }

  if (els.lockStatusBadge) {
    els.lockStatusBadge.textContent = session.locked
      ? "الأزرار مقفلة"
      : "الأزرار مفتوحة";
    els.lockStatusBadge.className = `state-badge ${session.locked ? "red" : "green"}`;
  }

  if (els.toggleLockBtn) {
    els.toggleLockBtn.textContent = session.locked
      ? "فتح الأزرار"
      : "قفل الأزرار";
  }

  if (
    els.timeSelector &&
    pageType === "host" &&
    document.activeElement !== els.timeSelector
  ) {
    els.timeSelector.value = String(session.maxTime || 3);
  }

  if (
    els.cooldownSelector &&
    pageType === "host" &&
    document.activeElement !== els.cooldownSelector
  ) {
    els.cooldownSelector.value = String(session.cooldown || 3);
  }

  if (els.deviceBuzzBtn) {
    const enabled = canBuzz(session);
    els.deviceBuzzBtn.disabled = !enabled;

    const amIWinner =
      session.winnerPlayerId && session.winnerPlayerId === local.deviceId;

    if (amIWinner) {
      els.deviceBuzzBtn.style.background = "#22c55e";
    } else if (isMyCooldownActive(session)) {
      els.deviceBuzzBtn.style.background = "#64748b";
    } else {
      els.deviceBuzzBtn.style.background = "#ef4444";
    }
  }

  if (els.connectionBadge) {
    els.connectionBadge.textContent = local.joinedPlayer
      ? "متصل"
      : "بانتظار الانضمام";
    els.connectionBadge.className =
      `state-badge ${local.joinedPlayer ? "green" : ""}`.trim();
  }

  renderWinner(session);
  renderHostBuzzButtons(session);
  renderTeamManager(session);
  renderTeamSelect(session);
  renderPlayerTeam(session);
}

function renderWinner(session) {
  if (!els.winnerEmpty || !els.winnerBox || !els.winnerName) return;

  const winnerTeam = getWinnerTeam(session);

  if (!winnerTeam || !session.winnerTeamId) {
    els.winnerEmpty.classList.remove("hidden");
    els.winnerBox.className = "winner-box";
    els.winnerName.textContent = "-";
    if (els.winnerTeamText) els.winnerTeamText.textContent = "الفريق: -";
    return;
  }

  els.winnerEmpty.classList.add("hidden");
  els.winnerBox.className = `winner-box show ${winnerTeam.colorClass}`;
  els.winnerName.textContent = session.winnerPlayerName || winnerTeam.name;
  if (els.winnerTeamText) {
    els.winnerTeamText.textContent = `الفريق: ${winnerTeam.name}`;
  }
}

function renderHostBuzzButtons(session) {
  if (!els.hostBuzzGrid) return;

  els.hostBuzzGrid.innerHTML = "";

  session.teams.forEach((team) => {
    const isWinner = session.winnerTeamId === team.id;

    const button = document.createElement("button");
    button.className = `team-buzz-btn ${team.colorClass}`;
    button.disabled = !canBuzz(session);

    button.innerHTML = `
      <div class="team-buzz-top">
        <span class="team-buzz-name">${escapeHtml(team.name)}</span>
        <span>${isWinner ? "✅" : "🔔"}</span>
      </div>
      <div class="team-buzz-note">${
        isWinner ? "هذا هو الفريق الذي ضغط أولاً" : "ضغط تجريبي من شاشة المشرف"
      }</div>
    `;

    button.addEventListener("click", () => {
      claimBuzz(team.id, "المشرف").catch((error) => {
        console.error(error);
        showToast("حدث خطأ أثناء تسجيل الضغط", true);
      });
    });

    els.hostBuzzGrid.appendChild(button);
  });
}

function renderTeamManager(session) {
  if (!els.teamManageList) return;

  els.teamManageList.innerHTML = "";

  session.teams.forEach((team) => {
    const row = document.createElement("div");
    row.className = "team-manage-row";

    const input = document.createElement("input");
    input.className = "input";
    input.value = team.name;
    input.maxLength = 40;

    input.addEventListener("change", async (e) => {
      try {
        const name = sanitizeName(e.target.value) || team.name;
        await updateTeamName(team.id, name);
      } catch (error) {
        console.error(error);
        showToast("تعذر تحديث اسم الفريق", true);
      }
    });

    const score = document.createElement("div");
    score.className = "score-box";
    score.textContent = String(team.points);

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn ghost";
    removeBtn.type = "button";
    removeBtn.textContent = "حذف";

    removeBtn.addEventListener("click", async () => {
      try {
        await removeTeam(team.id);
      } catch (error) {
        console.error(error);
        showToast("تعذر حذف الفريق", true);
      }
    });

    row.appendChild(input);
    row.appendChild(score);
    row.appendChild(removeBtn);

    els.teamManageList.appendChild(row);
  });
}

function renderTeamSelect(session) {
  if (!els.selectedTeam) return;

  const storedTeamId = (() => {
    try {
      const raw = localStorage.getItem("gb_player_profile");
      if (!raw) return null;
      const data = JSON.parse(raw);
      return Number(data?.teamId);
    } catch (error) {
      return null;
    }
  })();

  const currentValue =
    Number(els.selectedTeam.value) || storedTeamId || session.teams[0]?.id || 1;

  els.selectedTeam.innerHTML = "";

  session.teams.forEach((team) => {
    const option = document.createElement("option");
    option.value = String(team.id);
    option.textContent = team.name;
    if (team.id === currentValue) option.selected = true;
    els.selectedTeam.appendChild(option);
  });

  renderPlayerTeam(session);
}

function renderPlayerTeam(session) {
  if (!els.deviceTeamName) return;
  const selected = getSelectedTeam(session);
  els.deviceTeamName.textContent = selected ? selected.name : "-";
}

async function ensureSession(code) {
  const codeClean = String(code || "")
    .trim()
    .toUpperCase();

  if (!codeClean) throw new Error("كود الجلسة فارغ");

  const snapshot = await get(sessionRef(codeClean));

  if (!snapshot.exists()) {
    await set(sessionRef(codeClean), {
      code: codeClean,
      locked: false,
      timerRunning: false,
      timeLeft: 3,
      maxTime: 3,
      winnerTeamId: null,
      winnerPlayerName: "",
      winnerPlayerId: "",
      winnerPressedAt: null,
      teams: defaultTeams(),
      cooldown: 3,
      cooldownEndsAt: null,
      cooldownPlayerId: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  return codeClean;
}

async function attachPresence(code) {
  if (pageType !== "player" || !els.deviceName || !local.joinedPlayer) return;

  const pRef = presenceRef(code);
  const playerName = getCurrentPlayerName();
  const teamId = getSelectedTeamId();

  await set(pRef, {
    name: playerName,
    teamId: Number.isFinite(teamId) ? teamId : null,
    at: Date.now(),
    userAgent: navigator.userAgent,
  });

  onDisconnect(pRef).remove();
}

async function subscribeToSession(code) {
  local.currentSessionCode = code;

  if (typeof local.unsubscribeSession === "function") {
    local.unsubscribeSession();
    local.unsubscribeSession = null;
  }

  const sRef = sessionRef(code);

  local.unsubscribeSession = onValue(
    sRef,
    async (snapshot) => {
      if (!snapshot.exists()) {
        if (els.connectionBadge) {
          els.connectionBadge.textContent = "الجلسة غير موجودة";
          els.connectionBadge.className = "state-badge red";
        }
        showToast("هذه الجلسة غير موجودة", true);
        return;
      }

      const session = normalizeSession(snapshot.val(), code);
      local.lastSession = snapshot.val();
      renderSession(session);
    },
    (error) => {
      console.error(error);
      showToast("تعذر الاتصال بالجلسة", true);
    },
  );
}

async function createOrLoadSession(code = randomCode()) {
  const readyCode = await ensureSession(code);
  await subscribeToSession(readyCode);
  showToast("تم تجهيز الجلسة");
}

async function readCurrentSession() {
  if (!local.currentSessionCode) throw new Error("لا توجد جلسة حالية");

  const snapshot = await get(sessionRef(local.currentSessionCode));
  if (!snapshot.exists()) throw new Error("الجلسة غير موجودة");

  return normalizeSession(snapshot.val(), local.currentSessionCode);
}

async function updateSessionPatch(patch) {
  if (!local.currentSessionCode) throw new Error("لا توجد جلسة حالية");

  await update(sessionRef(local.currentSessionCode), {
    ...patch,
    updatedAt: Date.now(),
  });
}

async function resetToFreshRound(session, extraPatch = {}) {
  await updateSessionPatch({
    winnerTeamId: null,
    winnerPlayerName: "",
    winnerPlayerId: "",
    winnerPressedAt: null,
    locked: false,
    timerRunning: false,
    roundStartedAt: null,
    roundEndsAt: null,
    timeLeft: session.maxTime || Number(els.timeSelector?.value || 3),
    ...extraPatch,
    hostUpdatedAt: Date.now(),
  });
}

async function toggleTimer() {
  const session = await readCurrentSession();

  if (session.timeLeft <= 0) return;

  if (session.timerRunning) {
    await updateSessionPatch({
      timerRunning: false,
      roundEndsAt: null,
      hostUpdatedAt: Date.now(),
    });
  } else {
    await updateSessionPatch({
      timerRunning: true,
      roundStartedAt: Date.now(),
      roundEndsAt: Date.now() + session.timeLeft * 1000,
      hostUpdatedAt: Date.now(),
    });
  }
}

async function toggleLock() {
  const session = await readCurrentSession();

  await updateSessionPatch({
    locked: !session.locked,
    hostUpdatedAt: Date.now(),
  });
}

async function clearWinner() {
  const session = await readCurrentSession();

  await resetToFreshRound(session, {
    cooldownEndsAt: null,
    cooldownPlayerId: "",
  });
}

async function moveWinnerToCooldown() {
  const session = await readCurrentSession();

  if (!session.winnerPlayerId) {
    await resetToFreshRound(session);
    return;
  }

  await resetToFreshRound(session, {
    cooldownPlayerId: session.winnerPlayerId,
    cooldownEndsAt: Date.now() + session.cooldown * 1000,
  });
}

async function openAllForPlayers() {
  await moveWinnerToCooldown();
}

async function claimBuzz(teamId, playerName = "") {
  if (!local.currentSessionCode) return;

  const teamIdNum = Number(teamId);
  if (!Number.isFinite(teamIdNum)) return;

  const safePlayerName = sanitizeName(playerName) || "لاعب";
  const sRef = sessionRef(local.currentSessionCode);

  const result = await runTransaction(sRef, (current) => {
    if (!current) return current;

    const safe = normalizeSession(current, local.currentSessionCode);

    const myCooldownActive =
      Boolean(safe.cooldownPlayerId) &&
      safe.cooldownPlayerId === local.deviceId &&
      Boolean(safe.cooldownEndsAt) &&
      Date.now() < Number(safe.cooldownEndsAt);

    if (
      safe.locked ||
      safe.winnerTeamId !== null ||
      safe.timeLeft <= 0 ||
      myCooldownActive
    ) {
      return current;
    }

    return {
      ...current,
      winnerTeamId: teamIdNum,
      winnerPlayerName: safePlayerName,
      winnerPlayerId: local.deviceId,
      winnerPressedAt: Date.now(),
      locked: true,
      timerRunning: true,
      roundStartedAt: Date.now(),
      roundEndsAt: Date.now() + safe.timeLeft * 1000,

      // إلغاء منع اللاعب السابق مباشرة عند وجود فائز جديد
      cooldownPlayerId: "",
      cooldownEndsAt: null,

      hostUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    };
  });

  if (!result.committed) {
    showToast("سبقك جهاز آخر بالضغط", true);
  }
}

async function addPoint() {
  const session = await readCurrentSession();
  if (session.winnerTeamId == null) return;

  const teams = session.teams.map((team) =>
    team.id === session.winnerTeamId
      ? { ...team, points: Number(team.points || 0) + 1 }
      : team,
  );

  await resetToFreshRound(session, {
    teams,
    cooldownPlayerId: "",
    cooldownEndsAt: null,
  });
}

async function removePoint() {
  const session = await readCurrentSession();
  if (session.winnerTeamId == null) return;

  const teams = session.teams.map((team) =>
    team.id === session.winnerTeamId
      ? { ...team, points: Math.max(0, Number(team.points || 0) - 1) }
      : team,
  );

  await updateSessionPatch({
    teams,
    hostUpdatedAt: Date.now(),
  });
}

async function addTeam() {
  const name = sanitizeName(els.newTeamName?.value);
  if (!name) return;

  const session = await readCurrentSession();
  const nextId = Date.now();
  const colorClass =
    TEAM_COLORS[session.teams.length % TEAM_COLORS.length] || "team-slate";

  const teams = [...session.teams, { id: nextId, name, colorClass, points: 0 }];

  await updateSessionPatch({
    teams,
    hostUpdatedAt: Date.now(),
  });

  if (els.newTeamName) els.newTeamName.value = "";
  showToast("تمت إضافة الفريق");
}

async function removeTeam(teamId) {
  const session = await readCurrentSession();

  if (session.teams.length <= 1) {
    showToast("لا يمكن حذف آخر فريق", true);
    return;
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
    patch.roundStartedAt = null;
    patch.roundEndsAt = null;
  }

  await updateSessionPatch(patch);
}

async function updateTeamName(teamId, name) {
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

async function copyText(text, successMessage) {
  try {
    const safeText = String(text || "").trim();
    if (!safeText) {
      showToast("لا يوجد نص للنسخ", true);
      return;
    }

    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(safeText);
    } else {
      const temp = document.createElement("textarea");
      temp.value = safeText;
      temp.style.position = "fixed";
      temp.style.left = "-9999px";
      document.body.appendChild(temp);
      temp.focus();
      temp.select();
      document.execCommand("copy");
      temp.remove();
    }

    showToast(successMessage);
  } catch (error) {
    console.error(error);
    showToast("تعذر النسخ", true);
  }
}

async function startTickWorker() {
  if (pageType !== "host") return;

  setInterval(async () => {
    try {
      if (!local.currentSessionCode) return;

      const snapshot = await get(sessionRef(local.currentSessionCode));
      if (!snapshot.exists()) return;

      const session = normalizeSession(
        snapshot.val(),
        local.currentSessionCode,
      );
      if (!session.timerRunning || !session.roundEndsAt) return;

      const leftMs = Number(session.roundEndsAt) - Date.now();
      const nextLeft = Math.max(0, Math.ceil(leftMs / 1000));

      if (nextLeft > 0 && nextLeft !== session.timeLeft) {
        await update(sessionRef(local.currentSessionCode), {
          timeLeft: nextLeft,
          updatedAt: Date.now(),
        });
        return;
      }

      if (nextLeft <= 0) {
        if (session.winnerPlayerId) {
          await update(sessionRef(local.currentSessionCode), {
            timeLeft: session.maxTime || 3,
            timerRunning: false,
            roundEndsAt: null,
            roundStartedAt: null,
            locked: false,
            cooldownPlayerId: session.winnerPlayerId,
            cooldownEndsAt: Date.now() + session.cooldown * 1000,
            winnerTeamId: null,
            winnerPlayerName: "",
            winnerPlayerId: "",
            winnerPressedAt: null,
            updatedAt: Date.now(),
          });
        } else {
          await update(sessionRef(local.currentSessionCode), {
            timeLeft: session.maxTime || 3,
            timerRunning: false,
            roundEndsAt: null,
            roundStartedAt: null,
            locked: false,
            cooldownPlayerId: "",
            cooldownEndsAt: null,
            updatedAt: Date.now(),
          });
        }
      }
    } catch (error) {
      console.error(error);
    }
  }, 500);
}

function bindHostEvents() {
  if (els.createSessionBtn) {
    els.createSessionBtn.addEventListener("click", async () => {
      try {
        await createOrLoadSession(randomCode());
        const url = new URL(window.location.href);
        url.searchParams.set("session", local.currentSessionCode);
        window.history.replaceState({}, "", url.toString());
      } catch (error) {
        console.error(error);
        showToast("تعذر إنشاء الجلسة", true);
      }
    });
  }

  if (els.copyCodeBtn) {
    els.copyCodeBtn.addEventListener("click", () =>
      copyText(local.currentSessionCode, "تم نسخ الكود"),
    );
  }

  if (els.copyJoinBtn) {
    els.copyJoinBtn.addEventListener("click", () =>
      copyText(getPlayerJoinUrl(), "تم نسخ رابط الدخول"),
    );
  }

  if (els.toggleTimerBtn) {
    els.toggleTimerBtn.addEventListener("click", async () => {
      try {
        await toggleTimer();
      } catch (error) {
        console.error(error);
        showToast("تعذر تغيير حالة المؤقت", true);
      }
    });
  }

  if (els.openAllBtn) {
    els.openAllBtn.addEventListener("click", async () => {
      try {
        await openAllForPlayers();
      } catch (error) {
        console.error(error);
        showToast("تعذر فتح الأزرار للجميع", true);
      }
    });
  }

  if (els.toggleLockBtn) {
    els.toggleLockBtn.addEventListener("click", async () => {
      try {
        await toggleLock();
      } catch (error) {
        console.error(error);
        showToast("تعذر تغيير حالة القفل", true);
      }
    });
  }

  if (els.clearWinnerBtn) {
    els.clearWinnerBtn.addEventListener("click", async () => {
      try {
        await clearWinner();
      } catch (error) {
        console.error(error);
        showToast("تعذر مسح الفائز", true);
      }
    });
  }

  if (els.addPointBtn) {
    els.addPointBtn.addEventListener("click", async () => {
      try {
        await addPoint();
      } catch (error) {
        console.error(error);
        showToast("تعذر إضافة النقطة", true);
      }
    });
  }

  if (els.removePointBtn) {
    els.removePointBtn.addEventListener("click", async () => {
      try {
        await removePoint();
      } catch (error) {
        console.error(error);
        showToast("تعذر حذف النقطة", true);
      }
    });
  }

  if (els.addTeamBtn) {
    els.addTeamBtn.addEventListener("click", async () => {
      try {
        await addTeam();
      } catch (error) {
        console.error(error);
        showToast("تعذر إضافة الفريق", true);
      }
    });
  }

  if (els.newTeamName) {
    els.newTeamName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        addTeam().catch((error) => {
          console.error(error);
          showToast("تعذر إضافة الفريق", true);
        });
      }
    });
  }

  if (els.timeSelector) {
    els.timeSelector.addEventListener("change", syncHostSettings);
  }

  if (els.cooldownSelector) {
    els.cooldownSelector.addEventListener("change", syncHostSettings);
  }
}

function bindPlayerEvents() {
  if (els.selectedTeam) {
    els.selectedTeam.addEventListener("change", async () => {
      try {
        savePlayerDraft();
        const session = await readCurrentSession();
        renderPlayerTeam(session);
      } catch (error) {
        console.error(error);
      }
    });
  }

  if (els.deviceName) {
    els.deviceName.addEventListener("input", () => {
      savePlayerDraft();
    });
  }

  if (els.joinPlayerBtn) {
    els.joinPlayerBtn.addEventListener("click", async () => {
      try {
        const playerName = getCurrentPlayerName();
        const teamId = getSelectedTeamId();

        if (!playerName) {
          showToast("اكتب اسم اللاعب", true);
          return;
        }

        if (!Number.isFinite(teamId)) {
          showToast("اختر الفريق أولاً", true);
          return;
        }

        local.joinedPlayer = true;
        savePlayerDraft();
        showPlayerBuzzerView();
        await attachPresence(local.currentSessionCode);
        const session = await readCurrentSession();
        renderPlayerTeam(session);
        showToast("تم الانضمام");
      } catch (error) {
        console.error(error);
        showToast("تعذر الانضمام إلى الجلسة", true);
      }
    });
  }

  if (els.deviceBuzzBtn) {
    els.deviceBuzzBtn.addEventListener("click", async () => {
      try {
        const teamId = getSelectedTeamId();
        if (!Number.isFinite(teamId)) {
          showToast("اختر الفريق أولاً", true);
          return;
        }

        if (!local.joinedPlayer) {
          showToast("يجب الانضمام أولاً", true);
          return;
        }

        await attachPresence(local.currentSessionCode);
        await claimBuzz(teamId, getCurrentPlayerName());
      } catch (error) {
        console.error(error);
        showToast("تعذر إرسال الضغط", true);
      }
    });
  }
}

function bindEvents() {
  if (pageType === "host") bindHostEvents();
  if (pageType === "player") bindPlayerEvents();
}

async function boot() {
  if (pageType === "home") return;

  bindEvents();
  loadPlayerDraft();
  startUiTicker();
  await startTickWorker();

  const queryCode = new URLSearchParams(location.search).get("session");
  const cleanCode = String(queryCode || "")
    .trim()
    .toUpperCase();

  if (!cleanCode) {
    showToast("لا يوجد كود جلسة في الرابط", true);
    return;
  }

  if (pageType === "host") {
    await createOrLoadSession(cleanCode);
    const url = new URL(window.location.href);
    url.searchParams.set("session", cleanCode);
    window.history.replaceState({}, "", url.toString());
    return;
  }

  if (pageType === "player") {
    showPlayerJoinView();

    const snapshot = await get(sessionRef(cleanCode));
    if (!snapshot.exists()) {
      if (els.connectionBadge) {
        els.connectionBadge.textContent = "الجلسة غير موجودة";
        els.connectionBadge.className = "state-badge red";
      }
      showToast("هذه الجلسة غير موجودة", true);
      return;
    }

    await subscribeToSession(cleanCode);
  }
}

boot().catch((error) => {
  console.error(error);
  showToast("تحقق من إعدادات Firebase أو هيكل الملفات", true);
});
