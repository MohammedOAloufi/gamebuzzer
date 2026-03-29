import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  get,
  runTransaction,
  serverTimestamp,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

// ضع بيانات مشروعك من Firebase هنا
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "gamebuzzuer.firebaseapp.com",
  databaseURL: "https://gamebuzzuer-default-rtdb.firebaseio.com",
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

const local = {
  currentSessionCode: "",
  listenerOff: null,
  html5Qr: null,
  deviceId: crypto.randomUUID
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`,
};

const els = {
  sessionCode: document.getElementById("sessionCode"),
  deviceSessionCode: document.getElementById("deviceSessionCode"),
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
  startRoundBtn: document.getElementById("startRoundBtn"),
  toggleTimerBtn: document.getElementById("toggleTimerBtn"),
  resetRoundBtn: document.getElementById("resetRoundBtn"),
  toggleLockBtn: document.getElementById("toggleLockBtn"),
  clearWinnerBtn: document.getElementById("clearWinnerBtn"),

  winnerEmpty: document.getElementById("winnerEmpty"),
  winnerBox: document.getElementById("winnerBox"),
  winnerName: document.getElementById("winnerName"),
  addPointBtn: document.getElementById("addPointBtn"),

  hostBuzzGrid: document.getElementById("hostBuzzGrid"),
  teamManageList: document.getElementById("teamManageList"),
  newTeamName: document.getElementById("newTeamName"),
  addTeamBtn: document.getElementById("addTeamBtn"),

  selectedTeam: document.getElementById("selectedTeam"),
  deviceName: document.getElementById("deviceName"),
  joinCodeInput: document.getElementById("joinCodeInput"),
  joinByCodeBtn: document.getElementById("joinByCodeBtn"),
  deviceBuzzBtn: document.getElementById("deviceBuzzBtn"),
  deviceStateText: document.getElementById("deviceStateText"),
  deviceTimeLeft: document.getElementById("deviceTimeLeft"),
  deviceTeamName: document.getElementById("deviceTeamName"),
  connectionBadge: document.getElementById("connectionBadge"),

  startScannerBtn: document.getElementById("startScannerBtn"),
  stopScannerBtn: document.getElementById("stopScannerBtn"),
  reader: document.getElementById("reader"),

  toast: document.getElementById("toast"),
  tabButtons: document.querySelectorAll(".tab-btn"),
  tabPanels: document.querySelectorAll(".tab-panel"),
};

function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
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

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.style.background = isError ? "#dc2626" : "#10b981";
  els.toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function getBasePageUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function getJoinUrl(code = local.currentSessionCode) {
  return `${getBasePageUrl()}?session=${encodeURIComponent(code)}`;
}

function updateQRCode(code = local.currentSessionCode) {
  els.qrcode.innerHTML = "";
  new QRCode(els.qrcode, {
    text: getJoinUrl(code),
    width: 132,
    height: 132,
    colorDark: "#111827",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H,
  });
}

function switchTab(tabName) {
  els.tabButtons.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.tab === tabName),
  );
  els.tabPanels.forEach((panel) =>
    panel.classList.toggle("active", panel.id === `tab-${tabName}`),
  );
}

function normalizeSession(raw, code) {
  const teams =
    Array.isArray(raw?.teams) && raw.teams.length ? raw.teams : defaultTeams();
  return {
    code,
    locked: Boolean(raw?.locked),
    timerRunning: Boolean(raw?.timerRunning),
    timeLeft: Number.isFinite(raw?.timeLeft) ? raw.timeLeft : 20,
    maxTime: Number.isFinite(raw?.maxTime) ? raw.maxTime : 20,
    winnerTeamId: raw?.winnerTeamId ?? null,
    roundStartedAt: raw?.roundStartedAt ?? null,
    roundEndsAt: raw?.roundEndsAt ?? null,
    hostUpdatedAt: raw?.hostUpdatedAt ?? null,
    teams,
  };
}

function getWinnerTeam(session) {
  return session.teams.find((t) => t.id === session.winnerTeamId) || null;
}

function canBuzz(session) {
  return (
    !session.locked && session.winnerTeamId === null && session.timeLeft > 0
  );
}

function renderSession(session) {
  els.sessionCode.textContent = session.code;
  els.deviceSessionCode.textContent = session.code;
  els.joinUrlText.textContent = getJoinUrl(session.code);
  els.joinCodeInput.value = session.code;
  updateQRCode(session.code);

  const progress = (session.timeLeft / session.maxTime) * 100;
  els.timeLeftText.textContent = session.timeLeft;
  els.timerBig.textContent = session.timeLeft;
  els.deviceTimeLeft.textContent = session.timeLeft;
  els.progressBar.style.width = `${Math.max(0, progress)}%`;

  els.timerStatusBadge.textContent = session.timerRunning
    ? "الوقت يعمل"
    : "متوقف";
  els.timerStatusBadge.className =
    `state-badge ${session.timerRunning ? "green" : ""}`.trim();
  els.toggleTimerBtn.textContent = session.timerRunning
    ? "إيقاف مؤقت"
    : "تشغيل المؤقت";

  els.lockStatusBadge.textContent = session.locked
    ? "الأزرار مقفلة"
    : "الأزرار مفتوحة";
  els.lockStatusBadge.className = `state-badge ${session.locked ? "red" : "green"}`;
  els.toggleLockBtn.textContent = session.locked
    ? "فتح الأزرار"
    : "قفل الأزرار";
  els.deviceStateText.textContent = session.locked ? "مقفول" : "جاهز";

  renderWinner(session);
  renderHostBuzzButtons(session);
  renderTeamManager(session);
  renderTeamSelect(session);
  els.deviceBuzzBtn.disabled = !canBuzz(session);
  els.connectionBadge.textContent = "متصل";
}

function renderWinner(session) {
  const winner = getWinnerTeam(session);
  if (!winner) {
    els.winnerEmpty.classList.remove("hidden");
    els.winnerBox.className = "winner-box";
    return;
  }
  els.winnerEmpty.classList.add("hidden");
  els.winnerBox.className = `winner-box show ${winner.colorClass}`;
  els.winnerName.textContent = winner.name;
}

function renderHostBuzzButtons(session) {
  els.hostBuzzGrid.innerHTML = "";
  session.teams.forEach((team) => {
    const button = document.createElement("button");
    button.className = `team-buzz-btn ${team.colorClass}`;
    button.disabled = !canBuzz(session);
    button.innerHTML = `
          <div class="team-buzz-top">
            <span class="team-buzz-name">${escapeHtml(team.name)}</span>
            <span>🔔</span>
          </div>
          <div class="team-buzz-note">ضغط تجريبي من شاشة المشرف</div>
        `;
    button.addEventListener("click", () => claimBuzz(team.id));
    els.hostBuzzGrid.appendChild(button);
  });
}

function renderTeamManager(session) {
  els.teamManageList.innerHTML = "";
  session.teams.forEach((team) => {
    const row = document.createElement("div");
    row.className = "team-manage-row";

    const input = document.createElement("input");
    input.className = "input";
    input.value = team.name;
    input.maxLength = 40;
    input.addEventListener("change", async (e) => {
      const name = e.target.value.trim() || team.name;
      await updateTeamName(team.id, name);
    });

    const score = document.createElement("div");
    score.className = "score-box";
    score.textContent = team.points;

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn ghost";
    removeBtn.type = "button";
    removeBtn.textContent = "حذف";
    removeBtn.addEventListener("click", () => removeTeam(team.id));

    row.appendChild(input);
    row.appendChild(score);
    row.appendChild(removeBtn);
    els.teamManageList.appendChild(row);
  });
}

function renderTeamSelect(session) {
  const currentValue =
    Number(els.selectedTeam.value) || session.teams[0]?.id || 1;
  els.selectedTeam.innerHTML = "";
  session.teams.forEach((team) => {
    const option = document.createElement("option");
    option.value = String(team.id);
    option.textContent = team.name;
    if (team.id === currentValue) option.selected = true;
    els.selectedTeam.appendChild(option);
  });
  const selected = session.teams.find(
    (t) => t.id === Number(els.selectedTeam.value),
  );
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
      timeLeft: 20,
      maxTime: 20,
      winnerTeamId: null,
      teams: defaultTeams(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  return codeClean;
}

async function attachPresence(code) {
  const pRef = presenceRef(code);
  await set(pRef, {
    name: els.deviceName.value.trim() || "جهاز غير مسمى",
    at: Date.now(),
    userAgent: navigator.userAgent,
  });
  onDisconnect(pRef).remove();
}

async function subscribeToSession(code) {
  local.currentSessionCode = code;
  const sRef = sessionRef(code);
  onValue(
    sRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        els.connectionBadge.textContent = "الجلسة غير موجودة";
        return;
      }
      const session = normalizeSession(snapshot.val(), code);
      renderSession(session);
    },
    (error) => {
      console.error(error);
      showToast("تعذر الاتصال بالجلسة", true);
    },
  );

  await attachPresence(code);
  history.replaceState({}, "", getJoinUrl(code));
  switchTab(
    new URLSearchParams(location.search).get("session") ? "device" : "host",
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

async function startRound() {
  const session = await readCurrentSession();
  await updateSessionPatch({
    locked: false,
    timerRunning: true,
    timeLeft: session.maxTime || 20,
    winnerTeamId: null,
    roundStartedAt: Date.now(),
    roundEndsAt: Date.now() + (session.maxTime || 20) * 1000,
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

async function resetRound() {
  const session = await readCurrentSession();
  await updateSessionPatch({
    locked: false,
    timerRunning: false,
    timeLeft: session.maxTime || 20,
    winnerTeamId: null,
    roundStartedAt: null,
    roundEndsAt: null,
    hostUpdatedAt: Date.now(),
  });
}

async function toggleLock() {
  const session = await readCurrentSession();
  await updateSessionPatch({
    locked: !session.locked,
    hostUpdatedAt: Date.now(),
  });
}

async function clearWinner() {
  await updateSessionPatch({
    winnerTeamId: null,
    locked: false,
    hostUpdatedAt: Date.now(),
  });
}

async function claimBuzz(teamId) {
  if (!local.currentSessionCode) return;
  const sRef = sessionRef(local.currentSessionCode);
  const result = await runTransaction(sRef, (current) => {
    if (!current) return current;
    const safe = normalizeSession(current, local.currentSessionCode);
    if (safe.locked || safe.winnerTeamId !== null || safe.timeLeft <= 0) {
      return current;
    }
    return {
      ...current,
      winnerTeamId: teamId,
      locked: true,
      timerRunning: false,
      roundEndsAt: null,
      lastBuzzAt: Date.now(),
      lastBuzzDeviceId: local.deviceId,
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
      ? { ...team, points: (team.points || 0) + 1 }
      : team,
  );
  await updateSessionPatch({ teams, hostUpdatedAt: Date.now() });
}

async function addTeam() {
  const name = els.newTeamName.value.trim();
  if (!name) return;
  const session = await readCurrentSession();
  const nextId = Date.now();
  const colorClass =
    TEAM_COLORS[session.teams.length % TEAM_COLORS.length] || "team-slate";
  const teams = [...session.teams, { id: nextId, name, colorClass, points: 0 }];
  await updateSessionPatch({ teams, hostUpdatedAt: Date.now() });
  els.newTeamName.value = "";
  showToast("تمت إضافة الفريق");
}

async function removeTeam(teamId) {
  const session = await readCurrentSession();
  if (session.teams.length <= 1) {
    showToast("لا يمكن حذف آخر فريق", true);
    return;
  }
  const teams = session.teams.filter((team) => team.id !== teamId);
  const patch = { teams, hostUpdatedAt: Date.now() };
  if (session.winnerTeamId === teamId) {
    patch.winnerTeamId = null;
    patch.locked = false;
  }
  await updateSessionPatch(patch);
}

async function updateTeamName(teamId, name) {
  const session = await readCurrentSession();
  const teams = session.teams.map((team) =>
    team.id === teamId ? { ...team, name } : team,
  );
  await updateSessionPatch({ teams, hostUpdatedAt: Date.now() });
}

async function copyText(text, successMessage) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const temp = document.createElement("textarea");
      temp.value = text;
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

async function joinByCode() {
  try {
    const code = String(els.joinCodeInput.value || "")
      .trim()
      .toUpperCase();
    if (!code) {
      showToast("اكتب كود الجلسة أولاً", true);
      return;
    }
    const snapshot = await get(sessionRef(code));
    if (!snapshot.exists()) {
      showToast("هذه الجلسة غير موجودة", true);
      return;
    }
    await subscribeToSession(code);
    switchTab("device");
    showToast("تم الانضمام للجلسة");
  } catch (error) {
    console.error(error);
    showToast("تعذر الانضمام", true);
  }
}

async function startScanner() {
  try {
    if (!window.isSecureContext && location.hostname !== "localhost") {
      showToast("الكاميرا تحتاج HTTPS", true);
      return;
    }

    if (!local.html5Qr) {
      local.html5Qr = new Html5Qrcode("reader");
    }

    await local.html5Qr.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      async (decodedText) => {
        try {
          let code = "";
          if (decodedText.includes("?session=")) {
            const parsed = new URL(decodedText);
            code = parsed.searchParams.get("session") || "";
          } else {
            code = decodedText.trim().toUpperCase();
          }
          if (!code) return;
          els.joinCodeInput.value = code;
          await joinByCode();
          await stopScanner();
        } catch (error) {
          console.error(error);
        }
      },
    );
  } catch (error) {
    console.error(error);
    showToast("تعذر تشغيل الكاميرا", true);
  }
}

async function stopScanner() {
  try {
    if (local.html5Qr && local.html5Qr.isScanning) {
      await local.html5Qr.stop();
      await local.html5Qr.clear();
    }
  } catch (error) {
    console.error(error);
  }
}

function startTickWorker() {
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
      const leftMs = session.roundEndsAt - Date.now();
      const nextLeft = Math.max(0, Math.ceil(leftMs / 1000));
      if (nextLeft !== session.timeLeft) {
        const patch = { timeLeft: nextLeft, updatedAt: Date.now() };
        if (nextLeft <= 0) {
          patch.timerRunning = false;
          patch.roundEndsAt = null;
        }
        await update(sessionRef(local.currentSessionCode), patch);
      }
    } catch (error) {
      console.error(error);
    }
  }, 500);
}

function bindEvents() {
  els.tabButtons.forEach((btn) =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab)),
  );
  els.createSessionBtn.addEventListener("click", () =>
    createOrLoadSession(randomCode()),
  );
  els.copyCodeBtn.addEventListener("click", () =>
    copyText(local.currentSessionCode, "تم نسخ الكود"),
  );
  els.copyJoinBtn.addEventListener("click", () =>
    copyText(getJoinUrl(), "تم نسخ رابط الدخول"),
  );
  els.startRoundBtn.addEventListener("click", startRound);
  els.toggleTimerBtn.addEventListener("click", toggleTimer);
  els.resetRoundBtn.addEventListener("click", resetRound);
  els.toggleLockBtn.addEventListener("click", toggleLock);
  els.clearWinnerBtn.addEventListener("click", clearWinner);
  els.addPointBtn.addEventListener("click", addPoint);
  els.addTeamBtn.addEventListener("click", addTeam);
  els.newTeamName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTeam();
  });
  els.selectedTeam.addEventListener("change", () => {
    const option = els.selectedTeam.options[els.selectedTeam.selectedIndex];
    els.deviceTeamName.textContent = option ? option.textContent : "-";
  });
  els.deviceBuzzBtn.addEventListener("click", () =>
    claimBuzz(Number(els.selectedTeam.value)),
  );
  els.joinByCodeBtn.addEventListener("click", joinByCode);
  els.joinCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinByCode();
  });
  els.startScannerBtn.addEventListener("click", startScanner);
  els.stopScannerBtn.addEventListener("click", stopScanner);
}

async function boot() {
  bindEvents();
  startTickWorker();

  const queryCode = new URLSearchParams(location.search).get("session");
  if (queryCode) {
    switchTab("device");
    els.joinCodeInput.value = queryCode.toUpperCase();
    await joinByCode();
  } else {
    await createOrLoadSession(randomCode());
  }
}

boot().catch((error) => {
  console.error(error);
  showToast("تحقق من Firebase config أولاً", true);
});
