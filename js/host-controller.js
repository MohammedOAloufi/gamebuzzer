import { els } from "./dom.js";
import {
  pageType,
  local,
  PLAYER_ACTIVE_WINDOW_MS,
  SESSION_IDLE_DELETE_MS,
  HOST_HEARTBEAT_MS,
  SESSION_EXPIRY_MS,
} from "./state.js";
import { get, set } from "./firebase.js";
import {
  readCurrentSession,
  updateSessionPatch,
  toggleLock,
  clearWinner,
  openAllForPlayers,
  addPoint,
  addTeam,
  resolveWinnerFromPresses,
  sessionRef,
  normalizeSession,
} from "./session-service.js";
import { showToast } from "./ui-renderer.js";

export async function syncHostSettings() {
  if (!local.currentSessionCode) return;

  try {
    const session = await readCurrentSession();
    const newMaxTime = Number(els.timeSelector?.value || 3);
    const newCooldown = Number(els.cooldownSelector?.value || 0);

    const patch = {
      maxTime: newMaxTime,
      cooldown: newCooldown,
      hostUpdatedAt: Date.now(),
    };

    if (
      !session.timerRunning &&
      !session.answerExpired &&
      session.winnerTeamId === null
    ) {
      patch.timeLeft = newMaxTime;
    }

    await updateSessionPatch(patch);
  } catch (error) {
    console.error(error);
  }
}

export function stopHostHeartbeat() {
  if (local.hostHeartbeat) {
    clearInterval(local.hostHeartbeat);
    local.hostHeartbeat = null;
  }
}

export function startHostHeartbeat() {
  if (pageType !== "host") return;

  stopHostHeartbeat();

  local.hostHeartbeat = setInterval(async () => {
    try {
      if (!local.currentSessionCode) return;

      await updateSessionPatch({
        hostUpdatedAt: Date.now(),
      });
    } catch (error) {
      console.error("Host heartbeat error:", error);
    }
  }, HOST_HEARTBEAT_MS);
}

export async function cleanupInactiveSession() {
  if (pageType !== "host" || !local.currentSessionCode) return;

  try {
    const snapshot = await get(sessionRef(local.currentSessionCode));
    if (!snapshot.exists()) return;

    const session = normalizeSession(snapshot.val(), local.currentSessionCode);
    const presenceValues = Object.values(session.presence || {});
    const now = Date.now();

    const activePlayers = presenceValues.filter(
      (player) => now - Number(player?.at || 0) < PLAYER_ACTIVE_WINDOW_MS,
    );

    const lastActivity = Math.max(
      Number(session.updatedAt || 0),
      Number(session.hostUpdatedAt || 0),
      Number(session.winnerPressedAt || 0),
      Number(session.createdAt || 0),
      ...presenceValues.map((p) => Number(p?.at || 0)),
    );

    const sessionIsIdle = now - lastActivity > SESSION_IDLE_DELETE_MS;
    const sessionExpired =
      Boolean(session.expiresAt) && now > Number(session.expiresAt);

    if ((activePlayers.length === 0 && sessionIsIdle) || sessionExpired) {
      await set(sessionRef(local.currentSessionCode), null);

      local.currentSessionCode = "";
      local.lastSession = null;
      stopHostHeartbeat();
      showToast("تم حذف الجلسة غير النشطة");
    }
  } catch (error) {
    console.error(error);
  }
}

export async function startTickWorker() {
  if (pageType !== "host") return;

  setInterval(async () => {
    try {
      await cleanupInactiveSession();

      if (!local.currentSessionCode) return;

      await resolveWinnerFromPresses();

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
        await updateSessionPatch({
          timeLeft: nextLeft,
        });
        return;
      }

      if (nextLeft <= 0) {
        const cooldownEnabled = Number(session.cooldown || 0) > 0;

        await updateSessionPatch({
          timeLeft: session.maxTime || 3,
          timerRunning: false,
          answerExpired: true,
          roundEndsAt: null,
          roundStartedAt: null,
          locked: false,
          cooldownPlayerId: cooldownEnabled ? session.winnerPlayerId || "" : "",
          cooldownEndsAt:
            cooldownEnabled && session.winnerPlayerId
              ? Date.now() + session.cooldown * 1000
              : null,
          hostUpdatedAt: Date.now(),
        });
      }
    } catch (error) {
      console.error(error);
    }
  }, 500);
}

export function bindHostEvents() {
  if (els.copyCodeBtn) {
    els.copyCodeBtn.addEventListener("click", async () => {
      try {
        const safeText = String(local.currentSessionCode || "").trim();

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

        showToast("تم نسخ الكود");
      } catch (error) {
        console.error(error);
        showToast("تعذر النسخ", true);
      }
    });
  }

  if (els.copyJoinBtn) {
    els.copyJoinBtn.addEventListener("click", async () => {
      try {
        const { getPlayerJoinUrl } = await import("./utils.js");
        const safeText = String(getPlayerJoinUrl(local.currentSessionCode)).trim();

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

        showToast("تم نسخ رابط الدخول");
      } catch (error) {
        console.error(error);
        showToast("تعذر النسخ", true);
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

  if (els.addTeamBtn) {
    els.addTeamBtn.addEventListener("click", async () => {
      try {
        const autoName = await addTeam();
        showToast(`تمت إضافة ${autoName}`);
      } catch (error) {
        console.error(error);
        showToast("تعذر إضافة الفريق", true);
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