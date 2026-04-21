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
  canBuzz,
  claimBuzz,
  getBuzzBlockReason,
  getCurrentPlayerName,
  getSelectedTeamId,
  readCurrentSession,
  refreshSessionExpiry,
  presenceRef,
  sessionRef,
} from "./session-service.js";
import {
  clearBuzzButtonDomLock,
  renderPlayerTeam,
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
 * يربط نقرة زر الـ buzzer باللاعب بمنطق كامل لـ in-flight + debounce + safety timeout.
 *
 * دورة حياة النقرة:
 *   1. debounce رخيص                 — يتجاهل الضغطات المتتالية السريعة
 *   2. فحص canBuzz محلياً            — يمنع طلب شبكي عبثي
 *   3. set in-flight flags + token   — يمنع ضغطة ثانية + يُعلِّم الطلب برقم فريد
 *   4. safety timeout                — يفك الـ in-flight بعد BUZZ_INFLIGHT_TIMEOUT_MS
 *   5. claimBuzz(teamId, name, roundId) — الطلب الفعلي مع expectedRoundId
 *   6. finally: لا يفكّ إلا إذا كان نفس الـ token (يتجاهل الـ resolutions القديمة)
 */
function bindBuzzButtonEvents() {
  if (!els.deviceBuzzBtn) return;

  els.deviceBuzzBtn.addEventListener("click", async () => {
    // ── 1) debounce
    const nowMs = Date.now();
    if (nowMs - Number(local.lastPressTriggerAt || 0) < BUZZ_DEBOUNCE_MS) {
      return;
    }
    local.lastPressTriggerAt = nowMs;

    // ── 2) حواجز محلية قبل الشبكة
    if (local.playerBuzzInFlight) return;
    if (!local.joinedPlayer || !local.currentSessionCode) return;

    let session;
    try {
      session = await readCurrentSession();
    } catch (error) {
      console.warn("buzz click: readCurrentSession failed:", error?.message ?? error);
      showToast("تعذر الاتصال بالجلسة", true);
      return;
    }

    if (!canBuzz(session)) {
      const reason = getBuzzBlockReason(session, { strict: true });
      showToast(getBuzzRejectMessage(reason), true);
      return;
    }

    const expectedRoundId = Number(session.roundId || 1);
    const teamId = getSelectedTeamId();
    const playerName = getCurrentPlayerName();

    // ── 3) set in-flight state
    local.buzzToken = Number(local.buzzToken || 0) + 1;
    const myToken = local.buzzToken;
    local.playerBuzzInFlight = true;
    local.buzzStartedAt = Date.now();

    els.deviceBuzzBtn.dataset.pending = "1";
    els.deviceBuzzBtn.classList.add("is-pending");

    // ── 4) safety timeout — لا نعتمد عليه في الحالة العادية، لكنه ضمان
    //     ضد tab في الخلفية أو شبكة معلقة.
    if (local.buzzInflightTimer) clearTimeout(local.buzzInflightTimer);
    local.buzzInflightTimer = setTimeout(() => {
      if (local.buzzToken !== myToken) return;
      local.playerBuzzInFlight = false;
      local.buzzStartedAt = 0;
      local.buzzInflightTimer = null;
      clearBuzzButtonDomLock();
    }, BUZZ_INFLIGHT_TIMEOUT_MS);

    // ── 5) الطلب الفعلي
    let ok = false;
    try {
      ok = await claimBuzz(teamId, playerName, expectedRoundId);
    } catch (error) {
      console.warn("buzz click: claimBuzz threw:", error?.message ?? error);
    }

    // ── 6) finally: نتجاهل إذا كان الـ token قد تجاوزته ضغطة أحدث أو reset
    if (local.buzzToken !== myToken) return;

    if (ok) {
      local.playerAttemptRoundId = expectedRoundId;
    } else {
      // الفشل غالباً بسبب سبق لاعب أو تغيّر الجولة — showToast هنا اختياري
      // لأن renderSession سيحدّث الزر ليعكس السبب الحقيقي.
    }

    local.playerBuzzInFlight = false;
    local.buzzStartedAt = 0;
    if (local.buzzInflightTimer) {
      clearTimeout(local.buzzInflightTimer);
      local.buzzInflightTimer = null;
    }
    clearBuzzButtonDomLock();
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