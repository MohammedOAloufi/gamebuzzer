/**
 * session-runtime.js
 * إدارة دورة حياة الجلسة — الاشتراك والإنشاء
 *
 * ✅ إصلاح: تمت إزالة import من host-controller.js لكسر الـ Circular Dependency.
 *    استدعاء startHostHeartbeat() ينتقل إلى app.js بعد عودة createOrLoadSession.
 *
 * ✅ إصلاح: تمت إزالة deleteSessionIfExpired من داخل createOrLoadSession
 *    لأنها تُستدعى دائماً قبلها في app.js — لا حاجة لتكرارها.
 */

import { local } from "./state.js";
import { onValue } from "./firebase.js";
import {
  ensureSession,
  normalizeSession,
  sessionRef,
} from "./session-service.js";
import { renderSession, showToast } from "./ui-renderer.js";

// ─────────────────────────────────────────────
// Session Subscription
// ─────────────────────────────────────────────

/**
 * يشترك في تحديثات جلسة محددة عبر Firebase onValue
 * @param {string} code - كود الجلسة
 */
export async function subscribeToSession(code) {
  local.currentSessionCode = code;
  local.lastSession = null;
  local.lastQrCodeValue = "";
  local.lastTeamsRenderKey = "";

  // إلغاء الاشتراك القديم إن وُجد
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
      console.error("subscribeToSession error:", error);
      showToast("تعذر الاتصال بالجلسة", true);
    },
  );
}

// ─────────────────────────────────────────────
// Session Creation / Loading
// ─────────────────────────────────────────────

/**
 * يُنشئ جلسة جديدة أو يُحمّل موجودة، ثم يشترك فيها.
 *
 * ملاحظة: يتحمّل المُستدعي (app.js أو host-controller.js) مسؤولية:
 * 1. استدعاء deleteSessionIfExpired قبل هذه الدالة
 * 2. استدعاء startHostHeartbeat بعد عودتها (للـ host)
 *
 * @param {string} code - كود الجلسة
 * @returns {Promise<string>} - الكود النهائي للجلسة
 */
export async function createOrLoadSession(code) {
  const readyCode = await ensureSession(code);
  await subscribeToSession(readyCode);
  return readyCode;
}