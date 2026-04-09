import { pageType, local } from "./state.js";
import { onValue } from "./firebase.js";
import {
  deleteSessionIfExpired,
  ensureSession,
  normalizeSession,
  sessionRef,
} from "./session-service.js";
import { renderSession, showToast } from "./ui-renderer.js";
import { startHostHeartbeat } from "./host-controller.js";

export async function subscribeToSession(code) {
  local.currentSessionCode = code;
  local.lastSession = null;
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

export async function createOrLoadSession(code) {
  const readyCode = await ensureSession(code);

  const wasDeleted = await deleteSessionIfExpired(readyCode);
  if (wasDeleted) {
    throw new Error("الجلسة كانت منتهية وتم حذفها");
  }

  await subscribeToSession(readyCode);

  if (pageType === "host") {
    startHostHeartbeat();
  }

  return readyCode;
}