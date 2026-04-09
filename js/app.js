import { els } from "./dom.js";
import { pageType, local } from "./state.js";
import { onValue, get } from "./firebase.js";
import { randomCode } from "./utils.js";
import {
  deleteSessionIfExpired,
  ensureSession,
  normalizeSession,
  sessionRef,
} from "./session-service.js";
import {
  hideJoinError,
  renderSession,
  showJoinError,
  showPlayerJoinView,
  showToast,
  startUiTicker,
} from "./ui-renderer.js";
import {
  bindHostEvents,
  startHostHeartbeat,
  startTickWorker,
  stopHostHeartbeat,
} from "./host-controller.js";
import {
  attachPresence,
  bindPlayerEvents,
  loadPlayerDraft,
  stopPlayerHeartbeat,
} from "./player-controller.js";

async function subscribeToSession(code) {
  local.currentSessionCode = code;
  local.lastQrCodeValue = "";
  local.lastTeamsRenderKey = "";

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

  const wasDeleted = await deleteSessionIfExpired(readyCode);
  if (wasDeleted) {
    throw new Error("الجلسة كانت منتهية وتم حذفها");
  }

  await subscribeToSession(readyCode);

  if (pageType === "host") {
    startHostHeartbeat();
  }

  showToast("تم تجهيز الجلسة");
}

function bindHomeEvents() {
  if (els.createSessionBtn) {
    els.createSessionBtn.addEventListener("click", () => {
      const code = randomCode();
      window.location.href = `host.html?session=${encodeURIComponent(code)}`;
    });
  }

  if (els.joinCodeInput) {
    els.joinCodeInput.addEventListener("input", () => {
      hideJoinError();
    });

    els.joinCodeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        els.joinSessionBtn?.click();
      }
    });
  }

  if (els.joinSessionBtn) {
    els.joinSessionBtn.addEventListener("click", async () => {
      const code = String(els.joinCodeInput?.value || "")
        .trim()
        .toUpperCase();

      hideJoinError();

      if (!code) {
        showJoinError("اكتب كود الجلسة أولاً");
        els.joinCodeInput?.focus();
        return;
      }

      try {
        const wasDeleted = await deleteSessionIfExpired(code);

        if (wasDeleted) {
          showJoinError("هذه الجلسة انتهت وتم حذفها");
          els.joinCodeInput?.focus();
          return;
        }

        const snapshot = await get(sessionRef(code));

        if (!snapshot.exists()) {
          showJoinError("كود الجلسة غير صحيح أو الجلسة غير موجودة");
          els.joinCodeInput?.focus();
          return;
        }

        window.location.href = `player.html?session=${encodeURIComponent(code)}`;
      } catch (error) {
        console.error(error);
        showJoinError("تعذر التحقق من كود الجلسة");
      }
    });
  }
}

function bindEvents() {
  if (pageType === "home") {
    bindHomeEvents();
  }

  if (pageType === "host") {
    bindHostEvents();
  }

  if (pageType === "player") {
    bindPlayerEvents();
  }
}

function bindVisibilityEvents() {
  document.addEventListener("visibilitychange", async () => {
    try {
      if (document.hidden) return;

      if (pageType === "host" && local.currentSessionCode) {
        const { updateSessionPatch } = await import("./session-service.js");
        await updateSessionPatch({
          hostUpdatedAt: Date.now(),
        });
      }

      if (
        pageType === "player" &&
        local.currentSessionCode &&
        local.joinedPlayer
      ) {
        await attachPresence(local.currentSessionCode);
      }
    } catch (error) {
      console.error(error);
    }
  });

  window.addEventListener("beforeunload", () => {
    stopPlayerHeartbeat();
    stopHostHeartbeat();
  });
}

async function boot() {
  bindEvents();
  bindVisibilityEvents();

  if (pageType === "home") {
    return;
  }

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

  const wasDeleted = await deleteSessionIfExpired(cleanCode);

  if (wasDeleted) {
    showToast("هذه الجلسة انتهت وتم حذفها", true);
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