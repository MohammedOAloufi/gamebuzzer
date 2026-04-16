import { els } from "./dom.js";
import {
  pageType,
  local,
  PLAYER_ACTIVE_WINDOW_MS,
  SESSION_IDLE_DELETE_MS,
  HOST_HEARTBEAT_MS,
  getServerNow,
} from "./state.js";
import { get, set } from "./firebase.js";
import { getPlayerJoinUrl, randomCode } from "./utils.js";
import {
  readCurrentSession,
  updateSessionPatch,
  toggleLock,
  clearWinner,
  openAllForPlayers,
  addPoint,
  addTeam,
  sessionRef,
  normalizeSession,
} from "./session-service.js";
import { showToast } from "./ui-renderer.js";
import { createOrLoadSession } from "./session-runtime.js";

function playAudioSafe(audioEl) {
  if (!audioEl) return;

  try {
    audioEl.pause();
    audioEl.currentTime = 0;

    const playPromise = audioEl.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  } catch (error) {
    console.error(error);
  }
}

function buildRoundAudioKey(session) {
  return [
    String(session.code || local.currentSessionCode || ""),
    Number(session.roundId || 1),
    String(session.winnerPlayerId || ""),
    Number(session.roundStartedAt || 0),
  ].join(":");
}

export async function syncHostSettings() {
  if (!local.currentSessionCode) return;

  try {
    const session = await readCurrentSession();
    const newMaxTime = Number(els.timeSelector?.value || 3);
    const newCooldown = Number(els.cooldownSelector?.value || 0);

    const patch = {
      maxTime: newMaxTime,
      cooldown: newCooldown,
      hostUpdatedAt: getServerNow(),
    };

    if (!session.timerRunning) {
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
        hostUpdatedAt: getServerNow(),
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
    const serverNow = getServerNow();

    const activePlayers = presenceValues.filter(
      (player) => serverNow - Number(player?.at || 0) < PLAYER_ACTIVE_WINDOW_MS,
    );

    const lastActivity = Math.max(
      Number(session.updatedAt || 0),
      Number(session.hostUpdatedAt || 0),
      Number(session.winnerPressedAt || 0),
      Number(session.createdAt || 0),
      ...presenceValues.map((p) => Number(p?.at || 0)),
    );

    const sessionIsIdle = serverNow - lastActivity > SESSION_IDLE_DELETE_MS;
    const sessionExpired =
      Boolean(session.expiresAt) && serverNow > Number(session.expiresAt);

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

      const snapshot = await get(sessionRef(local.currentSessionCode));
      if (!snapshot.exists()) return;

      const session = normalizeSession(
        snapshot.val(),
        local.currentSessionCode,
      );

      if (!session.timerRunning || !session.roundEndsAt) return;

      const serverNow = getServerNow();
      const leftMs = Number(session.roundEndsAt) - serverNow;

      if (leftMs <= 0) {
        const cooldownEnabled = Number(session.cooldown || 0) > 0;
        const roundAudioKey = buildRoundAudioKey(session);

        if (startTickWorker._lastEndSoundKey !== roundAudioKey) {
          playAudioSafe(els.endTimeAudio);
          startTickWorker._lastEndSoundKey = roundAudioKey;
        }

        await updateSessionPatch({
          timeLeft: 0,
          timerRunning: false,
          answerExpired: true,
          roundEndsAt: null,
          roundStartedAt: null,
          locked: false,
          cooldownTeamId:
            cooldownEnabled && session.winnerTeamId !== null
              ? Number(session.winnerTeamId)
              : null,
          cooldownEndsAt:
            cooldownEnabled && session.winnerTeamId !== null
              ? serverNow + session.cooldown * 1000
              : null,
          presses: null,
          hostUpdatedAt: serverNow,
        });

        return;
      }

      const nextLeft = Math.max(1, Math.ceil(leftMs / 1000));

      if (nextLeft !== session.timeLeft) {
        await updateSessionPatch({
          timeLeft: nextLeft,
        });
      }
    } catch (error) {
      console.error(error);
    }
  }, 100);
}

function setSensitiveVisibility(visible) {
  const targets = [els.sessionSensitiveArea, els.sessionQrArea].filter(Boolean);

  targets.forEach((element) => {
    if (visible) {
      element.classList.remove("is-blurred");
    } else {
      element.classList.add("is-blurred");
    }
  });

  const eyeIcon = document.getElementById("eyeIcon");

  if (eyeIcon) {
    eyeIcon.src = visible ? "media/close-eye.png" : "media/view.png";
    eyeIcon.alt = visible ? "إخفاء" : "إظهار";
  }

  if (els.sessionPrivacyToggle) {
    els.sessionPrivacyToggle.title = visible
      ? "إخفاء بيانات الجلسة"
      : "إظهار بيانات الجلسة";
    els.sessionPrivacyToggle.setAttribute(
      "aria-label",
      visible ? "إخفاء بيانات الجلسة" : "إظهار بيانات الجلسة",
    );
  }
}

function bindSessionPrivacyToggle() {
  if (!els.sessionPrivacyToggle) return;

  setSensitiveVisibility(false);

  els.sessionPrivacyToggle.addEventListener("click", () => {
    const isHidden = els.sessionSensitiveArea?.classList.contains("is-blurred");
    setSensitiveVisibility(Boolean(isHidden));
  });
}

export function bindHostEvents() {
  bindSessionPrivacyToggle();

  if (els.createSessionBtn) {
    els.createSessionBtn.addEventListener("click", async () => {
      try {
        const newCode = randomCode();
        const readyCode = await createOrLoadSession(newCode);

        const url = new URL(window.location.href);
        url.searchParams.set("session", readyCode);
        window.history.replaceState({}, "", url.toString());

        if (els.sessionCode) {
          els.sessionCode.textContent = readyCode;
        }

        if (els.joinUrlText) {
          els.joinUrlText.textContent = getPlayerJoinUrl(readyCode);
        }

        showToast("تم إنشاء جلسة جديدة");
      } catch (error) {
        console.error(error);
        showToast("تعذر إنشاء جلسة جديدة", true);
      }
    });
  }

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
        const safeText = String(
          getPlayerJoinUrl(local.currentSessionCode),
        ).trim();

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