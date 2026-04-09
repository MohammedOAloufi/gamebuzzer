import { els } from "./dom.js";
import { pageType, local, PLAYER_HEARTBEAT_MS } from "./state.js";
import { onDisconnect, set, update } from "./firebase.js";
import {
  getCurrentPlayerName,
  getSelectedTeamId,
  readCurrentSession,
  refreshSessionExpiry,
  registerPress,
  presenceRef,
  sessionRef,
} from "./session-service.js";
import {
  renderPlayerTeam,
  showPlayerBuzzerView,
  showToast,
} from "./ui-renderer.js";
import { sanitizeName } from "./utils.js";

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

  await set(pRef, {
    name: playerName,
    teamId: Number.isFinite(teamId) ? teamId : null,
    at: Date.now(),
    userAgent: navigator.userAgent,
  });

  await update(sessionRef(code), {
    updatedAt: Date.now(),
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
        at: Date.now(),
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
    els.deviceBuzzBtn.addEventListener("click", async () => {
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

        await attachPresence(local.currentSessionCode);
        const ok = await registerPress(fixedTeamId, fixedPlayerName);

        if (!ok) {
          showToast("تم إغلاق الجولة أو سبق أن ضغطت", true);
        }
      } catch (error) {
        console.error(error);
        showToast("تعذر إرسال الضغط", true);
      }
    });
  }
}