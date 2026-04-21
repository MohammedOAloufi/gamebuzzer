/**
 * player-controller.js
 * منطق اللاعب — الـ presence والأحداث
 */

import { els } from "./dom.js";
import { pageType, local, PLAYER_HEARTBEAT_MS, getServerNow } from "./state.js";
import { onDisconnect, set, update } from "./firebase.js";
import {
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
}