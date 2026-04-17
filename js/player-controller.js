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
    case "join_required":
      return "يجب الانضمام أولاً";
    default:
      return "تعذر إرسال الضغط";
  }
}

function getCurrentRoundIdFromLocalSession() {
  const parsed = Number(local.lastSession?.roundId);
  return Number.isFinite(parsed) ? parsed : 1;
}

function hasConfirmedAttemptThisRound() {
  const currentRoundId = getCurrentRoundIdFromLocalSession();
  return Number(local.playerAttemptRoundId) === Number(currentRoundId);
}

function setBuzzPendingUi(isPending) {
  if (!els.deviceBuzzBtn) return;

  els.deviceBuzzBtn.disabled = Boolean(isPending);
  els.deviceBuzzBtn.dataset.pending = isPending ? "1" : "0";

  if (isPending) {
    els.deviceBuzzBtn.classList.add("is-pending");
  } else {
    els.deviceBuzzBtn.classList.remove("is-pending");
  }
}

export function clearBuzzButtonDomLock() {
  setBuzzPendingUi(false);
}

async function getAccurateBuzzBlockReason() {
  const session = await readCurrentSession();
  return getBuzzBlockReason(session, { strict: true });
}

async function handleBuzzInput() {
  try {
    if (local.playerBuzzInFlight) return;

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

    if (hasConfirmedAttemptThisRound()) {
      showToast("أنت مسجل ضغطة في هذه الجولة", true);
      return;
    }

    local.playerBuzzInFlight = true;
    setBuzzPendingUi(true);

    const currentRoundId = getCurrentRoundIdFromLocalSession();
    const ok = await claimBuzz(fixedTeamId, fixedPlayerName);

    if (!ok) {
      local.playerAttemptRoundId = null;
      clearBuzzButtonDomLock();

      const finalReason = await getAccurateBuzzBlockReason().catch(() => null);
      showToast(
        getBuzzRejectMessage(finalReason || "another_player_won"),
        true,
      );
      return;
    }

    local.playerAttemptRoundId = currentRoundId;
    clearBuzzButtonDomLock();
  } catch (error) {
    console.error(error);
    local.playerAttemptRoundId = null;
    clearBuzzButtonDomLock();
    showToast("تعذر إرسال الضغط", true);
  } finally {
    local.playerBuzzInFlight = false;
  }
}

function shouldIgnoreDuplicateMobileTrigger() {
  const now = Date.now();
  const delta = now - Number(local.lastPressTriggerAt || 0);

  if (delta >= 0 && delta < 700) {
    return true;
  }

  local.lastPressTriggerAt = now;
  return false;
}

function bindBuzzButtonEvents() {
  if (!els.deviceBuzzBtn) return;

  const triggerBuzz = async (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (shouldIgnoreDuplicateMobileTrigger()) return;
    await handleBuzzInput();
  };

  els.deviceBuzzBtn.addEventListener(
    "touchend",
    (event) => {
      triggerBuzz(event);
    },
    { passive: false },
  );

  els.deviceBuzzBtn.addEventListener("click", (event) => {
    triggerBuzz(event);
  });

  els.deviceBuzzBtn.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    triggerBuzz(event);
  });
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

  bindBuzzButtonEvents();
}