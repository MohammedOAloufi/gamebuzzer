/**
 * player-controller.js
 * منطق اللاعب — الـ presence والأحداث
 */

import { els } from "./dom.js";
import {
  pageType,
  local,
  PLAYER_HEARTBEAT_MS,
  BUZZ_INFLIGHT_TIMEOUT_MS,
  BUZZ_DEBOUNCE_MS,
  getServerNow,
} from "./state.js";
import { onDisconnect, set, update } from "./firebase.js";
import {
  applyProvisionalWinner,
  canBuzz,
  claimBuzz,
  getBuzzBlockReason,
  getCurrentPlayerName,
  getSelectedTeamId,
  normalizeSession,
  readCurrentSession,
  refreshSessionExpiry,
  presenceRef,
  sessionRef,
} from "./session-service.js";
import {
  clearBuzzButtonDomLock,
  renderPlayerTeam,
  renderSession,
  showPlayerBuzzerView,
  showToast,
} from "./ui-renderer.js";
import { sanitizeName } from "./utils.js";




// ─────────────────────────────────────────────
// Player Draft (sessionStorage)
// ─────────────────────────────────────────────

export function savePlayerDraft() {
  try {
    const payload = {
      name: sanitizeName(els.deviceName?.value),
      teamId: local.joinedPlayer
        ? local.playerTeamId
        : Number(els.selectedTeam?.value || null),
    };

    sessionStorage.setItem("gb_player_profile", JSON.stringify(payload));
  } catch (error) {
    console.error("savePlayerDraft error:", error);
  }
}

export function loadPlayerDraft() {
  try {
    const raw = sessionStorage.getItem("gb_player_profile");
    if (!raw) return;

    const data = JSON.parse(raw);

    if (els.deviceName && data?.name) {
      els.deviceName.value = String(data.name);
    }
  } catch (error) {
    console.error("loadPlayerDraft error:", error);
  }
}

// ─────────────────────────────────────────────
// Presence
// ─────────────────────────────────────────────

export async function attachPresence(code) {
  if (pageType !== "player" || !els.deviceName || !local.joinedPlayer) return;

  const pRef = presenceRef(code);
  const playerName = getCurrentPlayerName();
  const teamId = getSelectedTeamId();
  const serverNow = getServerNow();

  await set(pRef, {
    name: playerName,
    teamId: Number.isFinite(teamId) ? teamId : null,
    at: serverNow,
    userAgent: navigator.userAgent,
  });

  await update(sessionRef(code), {
    updatedAt: serverNow,
  });

  await refreshSessionExpiry();
  onDisconnect(pRef).remove();
}

export function stopPlayerHeartbeat() {
  if (local.playerHeartbeat) {
    clearInterval(local.playerHeartbeat);
    local.playerHeartbeat = null;
  }
}

export function startPresenceHeartbeat() {
  if (pageType !== "player") return;

  stopPlayerHeartbeat();

  local.playerHeartbeat = setInterval(async () => {
    try {
      if (!local.currentSessionCode || !local.joinedPlayer) return;

      await update(presenceRef(local.currentSessionCode), {
        name: getCurrentPlayerName(),
        teamId: getSelectedTeamId(),
        at: getServerNow(),
        userAgent: navigator.userAgent,
      });

      await refreshSessionExpiry();
    } catch (error) {
      console.error("Presence heartbeat error:", error);
    }
  }, PLAYER_HEARTBEAT_MS);
}

// ─────────────────────────────────────────────
// Buzz Button Events
// ─────────────────────────────────────────────

/**
 * رسائل رفض ضغط الـ buzz — مُشتقّة من reason الذي يعطيه getBuzzBlockReason.
 */
function getBuzzRejectMessage(reason) {
  switch (reason) {
    case "join_required":
      return "انضم إلى الجلسة أولاً";
    case "round_locked":
      return "الأزرار مقفلة الآن";
    case "team_cooldown":
      return "فريقك في فترة انتظار";
    case "another_player_won":
      return "سبقك لاعب آخر";
    case "already_pressed_this_round":
      return "ضغطت بالفعل في هذه الجولة";
    default:
      return "لا يمكن الضغط الآن";
  }
}

/**
 * يربط نقرة زر الـ buzzer بمنطق احترافي فوري.
 *
 * ⚡ تصميم "zero-latency":
 *   دورة النقرة الكاملة قبل أي انتظار شبكة (< 5ms):
 *     1. debounce + in-flight guard
 *     2. التقاط clickedAt = getServerNow() لحظة النقر
 *     3. فحص canBuzz على local.lastSession (موجود دائماً محدَّثاً)
 *     4. حقن الضغطة في local.lastSession محلياً
 *     5. renderSession فوري → المؤقت يبدأ من maxTime بالضبط
 *   ثم (بعد الرسم) fire-and-forget لـ claimBuzz للإرسال الشبكي.
 *
 *   ملاحظة أمان: hostResolver يبقى مصدر الحقيقة ويرفض أي ضغطة غير صحيحة
 *   داخل resolutionLock transaction. الحقن المحلي لا يُعدّل حالة الخادم.
 */
function bindBuzzButtonEvents() {
  if (!els.deviceBuzzBtn) return;

  els.deviceBuzzBtn.addEventListener("click", () => {
    // ── 1) debounce + in-flight
    const wallClock = Date.now();
    if (wallClock - Number(local.lastPressTriggerAt || 0) < BUZZ_DEBOUNCE_MS) {
      return;
    }
    local.lastPressTriggerAt = wallClock;

    if (local.playerBuzzInFlight) return;
    if (!local.joinedPlayer || !local.currentSessionCode) return;
    if (!local.lastSession) return;

    // ── 2) التقاط الوقت لحظة النقر (قبل أي async work)
    const clickedAt = getServerNow();

    // ── 3) فحص محلي من آخر snapshot (بدون شبكة)
    const session = normalizeSession(
      local.lastSession,
      local.currentSessionCode,
    );

    if (!canBuzz(session)) {
      const reason = getBuzzBlockReason(session, { strict: true });
      showToast(getBuzzRejectMessage(reason), true);
      return;
    }

    const expectedRoundId = Number(session.roundId || 1);
    const teamId = getSelectedTeamId();
    const playerName = getCurrentPlayerName();

    // ── 4) set in-flight state + token
    local.buzzToken = Number(local.buzzToken || 0) + 1;
    const myToken = local.buzzToken;
    local.playerBuzzInFlight = true;
    local.buzzStartedAt = Date.now();

    els.deviceBuzzBtn.dataset.pending = "1";
    els.deviceBuzzBtn.classList.add("is-pending");

    // ── 5) حقن الضغطة محلياً + رسم فوري
    //     المصفوفة presses قد تكون null — نضمن object.
    const existingPresses =
      local.lastSession.presses && typeof local.lastSession.presses === "object"
        ? local.lastSession.presses
        : {};

    local.lastSession = {
      ...local.lastSession,
      presses: {
        ...existingPresses,
        [local.deviceId]: {
          teamId,
          playerName,
          pressedAt: clickedAt,
          roundId: expectedRoundId,
        },
      },
    };

    // إعلام الـ UI: render فوري بالـ provisional winner.
    // نستخدم requestAnimationFrame لضمان دمج مع الإطار القادم (أسرع paint).
    const immediateSession = applyProvisionalWinner(
      normalizeSession(local.lastSession, local.currentSessionCode),
    );
    renderSession(immediateSession);

    // ── 6) safety timeout لفك الـ in-flight إن علقت الشبكة
    if (local.buzzInflightTimer) clearTimeout(local.buzzInflightTimer);
    local.buzzInflightTimer = setTimeout(() => {
      if (local.buzzToken !== myToken) return;
      local.playerBuzzInFlight = false;
      local.buzzStartedAt = 0;
      local.buzzInflightTimer = null;
      clearBuzzButtonDomLock();
    }, BUZZ_INFLIGHT_TIMEOUT_MS);

    // علامة نجاح متوقعة محلياً (تُصفَّر تلقائياً عند تغيّر roundId)
    local.playerAttemptRoundId = expectedRoundId;

    // ── 7) fire-and-forget: الإرسال الشبكي لا يُعيق الرسم
    claimBuzz(teamId, playerName, expectedRoundId, clickedAt)
      .then((ok) => {
        if (local.buzzToken !== myToken) return;

        local.playerBuzzInFlight = false;
        local.buzzStartedAt = 0;
        if (local.buzzInflightTimer) {
          clearTimeout(local.buzzInflightTimer);
          local.buzzInflightTimer = null;
        }
        clearBuzzButtonDomLock();

        if (!ok) {
          // فشل الإرسال — الـ host sync سيعكس الحقيقة تلقائياً في الـ subscription
          local.playerAttemptRoundId = null;
        }
      })
      .catch((error) => {
        console.warn("buzz click: claimBuzz threw:", error?.message ?? error);
        if (local.buzzToken !== myToken) return;
        local.playerBuzzInFlight = false;
        local.buzzStartedAt = 0;
        if (local.buzzInflightTimer) {
          clearTimeout(local.buzzInflightTimer);
          local.buzzInflightTimer = null;
        }
        clearBuzzButtonDomLock();
      });
  });
}

// ─────────────────────────────────────────────
// Player Event Binding
// ─────────────────────────────────────────────

export function bindPlayerEvents() {
  if (els.selectedTeam) {
    els.selectedTeam.addEventListener("change", async () => {
      try {
        savePlayerDraft();

        if (local.joinedPlayer && local.currentSessionCode) {
          await attachPresence(local.currentSessionCode);
        }

        const session = await readCurrentSession();
        renderPlayerTeam(session);
      } catch (error) {
        console.error("selectedTeam change error:", error);
      }
    });
  }

  if (els.deviceName) {
    els.deviceName.addEventListener("input", async () => {
      savePlayerDraft();

      if (local.joinedPlayer && local.currentSessionCode) {
        try {
          await attachPresence(local.currentSessionCode);
        } catch (error) {
          console.error("deviceName input error:", error);
        }
      }
    });
  }

  if (els.joinPlayerBtn) {
    els.joinPlayerBtn.addEventListener("click", async () => {
      try {
        const playerName = sanitizeName(els.deviceName?.value) || "لاعب";
        const teamId = Number(els.selectedTeam?.value);

        if (!playerName) {
          showToast("اكتب اسم اللاعب", true);
          return;
        }

        if (!Number.isFinite(teamId)) {
          showToast("اختر الفريق أولاً", true);
          return;
        }

        local.joinedPlayer = true;
        local.playerTeamId = Number(teamId);
        local.playerName = playerName;

        if (els.selectedTeam) els.selectedTeam.disabled = true;
        if (els.deviceName) els.deviceName.readOnly = true;

        savePlayerDraft();
        showPlayerBuzzerView();
        await attachPresence(local.currentSessionCode);
        startPresenceHeartbeat();
        const session = await readCurrentSession();
        renderPlayerTeam(session);
        showToast("تم الانضمام");
      } catch (error) {
        console.error("joinPlayerBtn error:", error);
        showToast("تعذر الانضمام إلى الجلسة", true);
      }
    });
  }

  bindBuzzButtonEvents();
}