import { els } from "./dom.js";
import { pageType, local, PLAYER_HEARTBEAT_MS, getServerNow } from "./state.js";
import { onDisconnect, set, update } from "./firebase.js";
import {
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
  renderPlayerTeam,
  showPlayerBuzzerView,
  showToast,
} from "./ui-renderer.js";
import { sanitizeName } from "./utils.js";

const BUZZ_POINTER_THROTTLE_MS = 180;

function getBuzzRejectMessage(reason) {
  switch (reason) {
    case "another_player_won":
      return "سبقك لاعب";
    case "round_locked":
      return "الجولة مقفلة";
    case "team_cooldown":
      return "فريقك عليه منع";
    case "already_pressed_this_round":
      return "أنت مسجل ضغطة في هذه الجولة";
    case "session_not_updated":
      return "الجلسة لم تتحدث بعد";
    case "join_required":
      return "يجب الانضمام أولاً";
    default:
      return "تعذر إرسال الضغط";
  }
}

function setBuzzPendingState() {
  local.playerBuzzPending = true;
  local.playerPendingStartedAt = Date.now();

  if (els.deviceBuzzBtn) {
    els.deviceBuzzBtn.dataset.pending = "1";
  }
}

function clearBuzzPendingState() {
  local.playerBuzzPending = false;
  local.playerPendingStartedAt = 0;

  if (els.deviceBuzzBtn) {
    els.deviceBuzzBtn.dataset.pending = "0";
  }
}

async function getAccurateBuzzBlockReason() {
  const session = await readCurrentSession();
  return getBuzzBlockReason(session, { strict: true });
}

function setPointerThrottle(ms = BUZZ_POINTER_THROTTLE_MS) {
  local.playerBuzzThrottleUntil = Date.now() + Math.max(0, Number(ms || 0));
}

function isPointerThrottled() {
  return Date.now() < Number(local.playerBuzzThrottleUntil || 0);
}

function getCurrentRoundIdFromLocalSession() {
  const raw = local.lastSession;
  const parsed = Number(raw?.roundId);
  return Number.isFinite(parsed) ? parsed : 1;
}

function hasAttemptedThisRound() {
  const currentRoundId = getCurrentRoundIdFromLocalSession();
  return Number(local.lastBuzzAttemptRoundId) === Number(currentRoundId);
}

function markAttemptForCurrentRound() {
  local.lastBuzzAttemptRoundId = getCurrentRoundIdFromLocalSession();
}

async function handleBuzzInput() {
  try {
    const fixedTeamId = Number(local.playerTeamId);
    const fixedPlayerName = local.playerName || getCurrentPlayerName();

    if (!Number.isFinite(fixedTeamId)) {
      showToast("اختر الفريق أولاً", true);
      return;
    }

    if (!local.joinedPlayer) {
      showToast("يجب الانضمام أولاً", true);
      return;
    }

    if (local.playerBuzzPending) {
      return;
    }

    if (isPointerThrottled()) {
      return;
    }

    if (hasAttemptedThisRound()) {
      showToast("أنت مسجل ضغطة في هذه الجولة", true);
      return;
    }

    setPointerThrottle(BUZZ_POINTER_THROTTLE_MS);
    markAttemptForCurrentRound();
    setBuzzPendingState();

    const ok = await claimBuzz(fixedTeamId, fixedPlayerName);

    if (!ok) {
      const finalReason = await getAccurateBuzzBlockReason().catch(() => null);

      showToast(
        getBuzzRejectMessage(finalReason || "another_player_won"),
        true,
      );

      clearBuzzPendingState();
      return;
    }

    // لا نفك pending هنا.
    // الرندر سيفكها عند تغير حالة مؤكدة في الجولة.
  } catch (error) {
    console.error(error);
    showToast("تعذر إرسال الضغط", true);
    clearBuzzPendingState();
  }
}

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
    console.error(error);
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
    console.error(error);
  }
}

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
        console.error(error);
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
          console.error(error);
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

        if (els.selectedTeam) {
          els.selectedTeam.disabled = true;
        }

        if (els.deviceName) {
          els.deviceName.readOnly = true;
        }

        savePlayerDraft();
        showPlayerBuzzerView();
        await attachPresence(local.currentSessionCode);
        startPresenceHeartbeat();

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
    els.deviceBuzzBtn.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handleBuzzInput();
    });
  }
}