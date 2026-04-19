/**
 * player-controller.js
 * منطق اللاعب — الـ buzz، الـ presence، والأحداث
 *
 * ✅ إصلاح 1: تقليل BUZZ_INFLIGHT_TIMEOUT_MS من 5000ms إلى 2000ms
 * ✅ إصلاح 2: forceReleaseBuzzLock يُصفّر lastPressTriggerAt و buzzStartedAt
 *             حتى الضغطة التالية بعد فك القفل لا تُتجاهل أبداً بسبب الـ debounce
 * ✅ إصلاح 3: playerAttemptRoundId لا يُضبط إلا إذا لم تتغير الجولة خلال الانتظار
 *             يمنع التعليق الصامت عندما يعود claimBuzz بعد reset الجولة
 * ✅ إصلاح 4: حذف background get في مسار ok=false — onValue يتكفل بتحديث lastSession
 * ✅ إصلاح 5: تسجيل buzzStartedAt عند بدء كل buzz لمنح safety valve في renderSession
 * ✅ إصلاح 6 (النهائي): حل deadlock بثلاث آليات:
 *             - Guard محسّن: يفك القفل إذا مضت > 3 ثواني ويحاول مجدداً فوراً
 *             - startBuzzLockCleanupTimer: timer في الخلفية يفك القفل كل 10 ثواني
 *             - clearPlayerRoundState: تنظيف عند تغيير الجولة
 */

import { els } from "./dom.js";
import { pageType, local, PLAYER_HEARTBEAT_MS, getServerNow } from "./state.js";
import { onDisconnect, set, update } from "./firebase.js";
import {
  claimBuzz,
  getBuzzBlockReason,
  getCurrentPlayerName,
  getSelectedTeamId,
  normalizeSession,
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
// Constants
// ─────────────────────────────────────────────

/**
 * أقصى وقت انتظار للـ buzz قبل فك القفل تلقائياً.
 *
 * 2000ms (بدلاً من 5000ms) — معظم transactions Firebase تكتمل خلال 300-800ms
 * حتى على شبكات بطيئة. 2 ثانية توازن بين إعطاء Firebase وقتاً كافياً
 * وبين عدم إبقاء اللاعب منتظراً طويلاً.
 */
const BUZZ_INFLIGHT_TIMEOUT_MS = 2000;

// ─────────────────────────────────────────────
// Buzz Rejection Messages
// ─────────────────────────────────────────────

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

/**
 * ✅ إصلاح Bug 6 (المستوى 1 - آلية الحماية):
 * تصفير آمن للـ buzz lock عند تحديث الجلسة
 * 
 * يُستدعى من renderSession للتحقق من أن الـ buzz المعلق
 * لا يزال متوقعاً. لو لم يعد متوقعاً (مثلاً انتقل اللاعب
 * لجولة جديدة)، نفك القفل فوراً.
 */
export function resetBuzzLockIfStale(session) {
  // لو لم يكن هناك buzz معلق، لا فعل مطلوب
  if (!local.playerBuzzInFlight) return;

  // إذا كانت الجولة تغيرت منذ بدأ الـ buzz، فك القفل فوراً
  const currentRoundId = Number(session?.roundId || 1);
  const buzzRoundId = Number(local.buzzRoundId || 1);

  if (currentRoundId !== buzzRoundId) {
    console.log(
      `resetBuzzLockIfStale: round changed (${buzzRoundId} → ${currentRoundId}) — releasing lock`
    );
    const newToken = (local.buzzToken || 0) + 1;
    local.buzzToken = newToken;
    forceReleaseBuzzLock(newToken);
    return;
  }

  // إذا مضت مدة طويلة على بدء الـ buzz (> 5 ثواني)، فك القفل
  // (safety valve إضافية للحالات النادرة جداً)
  const now = Date.now();
  const buzzAge = now - Number(local.buzzStartedAt || 0);
  if (buzzAge > 5000) {
    console.log(`resetBuzzLockIfStale: stale buzz (${buzzAge}ms old) — releasing lock`);
    const newToken = (local.buzzToken || 0) + 1;
    local.buzzToken = newToken;
    forceReleaseBuzzLock(newToken);
    return;
  }
}

// ─────────────────────────────────────────────
// Round ID Helpers
// ─────────────────────────────────────────────

function getCurrentRoundIdFromLocalSession() {
  const parsed = Number(local.lastSession?.roundId);
  return Number.isFinite(parsed) ? parsed : 1;
}

function hasConfirmedAttemptThisRound() {
  const currentRoundId = getCurrentRoundIdFromLocalSession();
  return Number(local.playerAttemptRoundId) === Number(currentRoundId);
}

/**
 * ✅ إصلاح Bug 6 (المستوى 3):
 * تنظيف تلقائي لحالة اللاعب عند تغيير الجولة
 * 
 * عندما ينتقل النظام إلى جولة جديدة، يجب مسح:
 * - playerAttemptRoundId (الضغطة المسجلة في الجولة القديمة)
 * - buzzer lock states (لو كان معلقاً)
 */
export function clearPlayerRoundState(newRoundId) {
  const previousRoundId = getCurrentRoundIdFromLocalSession();
  const normalizedNewRound = Number(newRoundId);

  if (previousRoundId !== normalizedNewRound) {
    console.log(
      `clearPlayerRoundState: clearing old round (${previousRoundId}) for new round (${normalizedNewRound})`
    );

    // مسح تسجيل الضغطة من الجولة القديمة
    local.playerAttemptRoundId = null;

    // إذا كان هناك buzz معلق من جولة قديمة، فك قفله فوراً
    if (local.playerBuzzInFlight) {
      console.log("clearPlayerRoundState: clearing stale buzz lock from old round");
      const newToken = (local.buzzToken || 0) + 1;
      local.buzzToken = newToken;
      forceReleaseBuzzLock(newToken);
    }

    // مسح debounce window لضمان الاستجابة الفورية في الجولة الجديدة
    local.lastPressTriggerAt = 0;
    
    // ✅ مسح buzzStartedAt لتجنب تفعيل safety valve من جولة قديمة
    local.buzzStartedAt = 0;
  }
}

// ─────────────────────────────────────────────
// Buzz Button DOM State
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Buzz Lock Management
// ─────────────────────────────────────────────

/**
 * يفك قفل الـ buzz بأمان كامل.
 *
 * يستخدم token للتحقق من أن هذا الـ finally ينتمي للطلب الحالي —
 * يمنع finally قديم من فك قفل طلب جديد بدأ بعده.
 *
 * ✅ إصلاح Bug 1:
 *    يُصفّر lastPressTriggerAt و buzzStartedAt حتى الضغطة التالية مباشرة بعد
 *    فك القفل لا تُتجاهل بسبب debounce window المتبقية من الضغطة القديمة.
 *
 * @param {number|undefined} token - رقم الطلب الذي طلب الفك
 */
function forceReleaseBuzzLock(token) {
  // لو كان الـ token قديماً — هذا finally من طلب سابق منتهٍ، نتجاهله
  if (token !== undefined && local.buzzToken !== token) return;

  local.playerBuzzInFlight = false;

  // ✅ إصلاح Bug 1: نُصفّر الـ debounce حتى الضغطة التالية تعمل فوراً
  local.lastPressTriggerAt = 0;

  // ✅ إصلاح Bug 4 (safety): نُصفّر توقيت البدء
  local.buzzStartedAt = 0;

  if (local.buzzInflightTimer) {
    clearTimeout(local.buzzInflightTimer);
    local.buzzInflightTimer = null;
  }

  clearBuzzButtonDomLock();
}

// ─────────────────────────────────────────────
// Core Buzz Handler
// ─────────────────────────────────────────────

async function handleBuzzInput() {
  // ─── Guard 1: منع الضغط المتكرر أثناء معالجة طلب سابق ───
  // ✅ إصلاح محسّن: إذا مضت > 3 ثواني، فك القفل وحاول مجدداً
  if (local.playerBuzzInFlight) {
    const buzzAge = Date.now() - Number(local.buzzStartedAt || 0);
    if (buzzAge > 3000) {
      // القفل معلق أكثر من 3 ثواني → فك القفل بالقوة وحاول مجدداً
      console.warn(`Guard: buzz lock stale (${buzzAge}ms) — force releasing and retrying`);
      const newToken = (local.buzzToken || 0) + 1;
      local.buzzToken = newToken;
      forceReleaseBuzzLock(newToken);
      // استمر في المعالجة (لا تُرجع)
    } else {
      // لا تزال في انتظار (< 3 ثواني)
      return;
    }
  }

  // ─── Guard 2: التحقق من بيانات اللاعب ───
  const fixedTeamId = Number(local.playerTeamId);
  const fixedPlayerName = local.playerName || getCurrentPlayerName();

  if (!Number.isFinite(fixedTeamId)) {
    showToast("اختر الفريق أولاً", true);
    local.playerBuzzInFlight = false;
    return;
  }

  if (!local.joinedPlayer) {
    showToast("يجب الانضمام أولاً", true);
    local.playerBuzzInFlight = false;
    return;
  }

  if (hasConfirmedAttemptThisRound()) {
    showToast("أنت مسجل ضغطة في هذه الجولة", true);
    local.playerBuzzInFlight = false;
    return;
  }

  // ─── إعداد الـ token والقفل ───
  // token فريد لكل طلب — يمنع finally قديم من التدخل في طلب جديد
  local.buzzToken = (local.buzzToken || 0) + 1;
  const myToken = local.buzzToken;

  // حفظ roundId لحظة بدء الطلب — نقارنه لاحقاً للتحقق من أن الجولة لم تتغير
  const roundIdAtBuzzStart = getCurrentRoundIdFromLocalSession();

  // ✅ إصلاح Bug 6 (المستوى 1): احفظ معرّف الجولة عند بدء الـ buzz
  // لاستخدامه في resetBuzzLockIfStale للكشف عن تغيير الجولة
  local.buzzRoundId = roundIdAtBuzzStart;

  // ✅ إصلاح Bug 5: سجّل وقت البدء للـ safety valve في renderSession
  local.buzzStartedAt = Date.now();

  setBuzzPendingUi(true);

  // إلغاء أي timeout قديم وبدء جديد
  if (local.buzzInflightTimer) {
    clearTimeout(local.buzzInflightTimer);
  }

  local.buzzInflightTimer = setTimeout(() => {
    console.warn(`buzz lock timeout (${BUZZ_INFLIGHT_TIMEOUT_MS}ms) — releasing`);
    forceReleaseBuzzLock(myToken);
  }, BUZZ_INFLIGHT_TIMEOUT_MS);

  try {
    const ok = await claimBuzz(fixedTeamId, fixedPlayerName, roundIdAtBuzzStart);

    if (!ok) {
      local.playerAttemptRoundId = null;

      // عرض رسالة الرفض من البيانات المحلية — بدون await للسرعة
      // ملاحظة: onValue يتكفل بتحديث lastSession تلقائياً — لا حاجة لـ get يدوي
      const localSession = local.lastSession
        ? normalizeSession(local.lastSession, local.currentSessionCode)
        : null;
      const localReason = localSession
        ? getBuzzBlockReason(localSession, { strict: true })
        : null;

      // ❌ إزالة shouldRetryBuzz لأنها تسبب deadlock
      // عند فشل claimBuzz (لاعب آخر سبقك)، فقط اعرض الرسالة
      showToast(getBuzzRejectMessage(localReason || "another_player_won"), true);
      return;
    }

    // ✅ إصلاح Bug 2:
    // نتحقق من أن الجولة لم تتغير خلال وقت انتظار claimBuzz
    // لو تغيرت، لا نسجّل الضغطة — المستخدم سيتمكن من الضغط في الجولة الجديدة
    const roundIdNow = getCurrentRoundIdFromLocalSession();

    if (roundIdNow === roundIdAtBuzzStart) {
      local.playerAttemptRoundId = roundIdAtBuzzStart;
    } else {
      // الجولة تغيرت خلال الانتظار — الـ transaction ألغي أصلاً على الخادم
      // (claimBuzz يتحقق من expectedRoundId)، لذا ok=true هنا غير متوقع
      // لكن كاحتياط لا نسجّل أي ضغطة
      local.playerAttemptRoundId = null;
      console.warn("buzz ok=true but round changed — ignoring attempt record");
    }
  } catch (error) {
    console.error("handleBuzzInput error:", error);
    local.playerAttemptRoundId = null;
    showToast("تعذر إرسال الضغط", true);
  } finally {
    // يفك القفل فقط إذا كان هذا الطلب هو صاحب القفل الحالي
    forceReleaseBuzzLock(myToken);
  }
}

// ─────────────────────────────────────────────
// Mobile Duplicate Event Guard
// ─────────────────────────────────────────────

/**
 * يمنع touchend + click من الموبايل من تشغيل buzz مرتين.
 *
 * المنطق:
 * - أول ضغطة حقيقية: lastPressTriggerAt=0 → delta كبير → NOT ignored
 * - click الذي يلي touchend بـ 50-300ms: delta < 1000 → ignored ✓
 * - ضغطة حقيقية جديدة بعد ثانية: delta > 1000 → NOT ignored
 *
 * ملاحظة: forceReleaseBuzzLock يُصفّر lastPressTriggerAt=0 عند فك القفل
 * حتى أول ضغطة بعد الفك تعمل فوراً حتى لو كانت خلال ثانية من الضغطة القديمة.
 */
function shouldIgnoreDuplicateMobileTrigger() {
  const now = Date.now();
  const delta = now - Number(local.lastPressTriggerAt || 0);

  // 0 يعني تمت إعادة الضبط (من forceReleaseBuzzLock أو clearPlayerRoundState)
  // → الضغطة هذه حقيقية ويجب تنفيذها فوراً
  if (local.lastPressTriggerAt === 0) {
    local.lastPressTriggerAt = now;
    return false;
  }

  if (delta < 1000) {
    // ضغطة مكررة من نفس اللمسة (touchend + click)
    return true;
  }

  local.lastPressTriggerAt = now;
  return false;
}

// ─────────────────────────────────────────────
// Buzz Button Event Binding
// ─────────────────────────────────────────────

function bindBuzzButtonEvents() {
  if (!els.deviceBuzzBtn) return;

  const triggerBuzz = async (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    // ✅ منع spam: حجب فوري قبل حتى handleBuzzInput
    if (local.playerBuzzInFlight) {
      console.warn(`buzz already in flight — ignoring`);
      return;
    }

    if (shouldIgnoreDuplicateMobileTrigger()) return;
    
    // ✅ ضبط الـ flag فوراً قبل await
    local.playerBuzzInFlight = true;
    
    try {
      await handleBuzzInput();
    } finally {
      // لا نفك هنا - handleBuzzInput تفك عن طريق finally الخاصة بها
    }
  };

  // touchend أولاً لاستجابة فورية على الجوال (قبل ظهور click بـ 300ms)
  els.deviceBuzzBtn.addEventListener(
    "touchend",
    (event) => { triggerBuzz(event); },
    { passive: false },
  );

  // click للـ desktop والحالات التي لا يوجد فيها touchend
  els.deviceBuzzBtn.addEventListener("click", (event) => {
    triggerBuzz(event);
  });

  // keyboard (Enter / Space) للـ accessibility
  els.deviceBuzzBtn.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    triggerBuzz(event);
  });
}

// ─────────────────────────────────────────────
// Background Buzz Lock Cleanup
// ─────────────────────────────────────────────

/**
 * ✅ إصلاح نهائي: Cleanup timer في الخلفية
 * يفك القفل كل 10 ثواني إذا كان معلقاً
 * هذا يضمن عدم التعليق حتى لو فشلت كل الآليات الأخرى
 */
export function startBuzzLockCleanupTimer() {
  if (pageType !== "player") return;

  // إلغاء أي timer قديم
  if (local.buzzLockCleanupTimer) {
    clearInterval(local.buzzLockCleanupTimer);
  }

  // بدء timer جديد كل 10 ثواني
  local.buzzLockCleanupTimer = setInterval(() => {
    if (local.playerBuzzInFlight) {
      const buzzAge = Date.now() - Number(local.buzzStartedAt || 0);
      
      // إذا مضت > 10 ثواني، فك القفل بالقوة
      if (buzzAge > 10000) {
        console.warn(
          `Background cleanup: buzz lock stale (${buzzAge}ms) — force releasing`
        );
        const newToken = (local.buzzToken || 0) + 1;
        local.buzzToken = newToken;
        forceReleaseBuzzLock(newToken);
      }
    }
  }, 10000); // كل 10 ثواني
}

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
        startBuzzLockCleanupTimer();  // ✅ بدء الـ cleanup timer

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