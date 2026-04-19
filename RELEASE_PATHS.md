# خريطة مسارات فك القفل (buzz lock release paths)

## جميع مسارات فك playerBuzzInFlight:

### 1️⃣ في `player-controller.js`:

#### المسار الأول: timeout في handleBuzzInput
```javascript
local.buzzInflightTimer = setTimeout(() => {
  console.warn(`buzz lock timeout (${BUZZ_INFLIGHT_TIMEOUT_MS}ms) — releasing`);
  forceReleaseBuzzLock(myToken);  // ← 2000ms timeout
}, BUZZ_INFLIGHT_TIMEOUT_MS);
```
**متى**: بعد 2 ثانية من بدء buzz
**النتيجة**: playerBuzzInFlight = false

#### المسار الثاني: finally في handleBuzzInput
```javascript
finally {
  // يفك القفل فقط إذا كان هذا الطلب هو صاحب القفل الحالي
  forceReleaseBuzzLock(myToken);  // ← دائماً
}
```
**متى**: بعد اكتمال try/catch
**النتيجة**: playerBuzzInFlight = false

#### المسار الثالث: Guard إذا buzz > 3 ثواني
```javascript
if (local.playerBuzzInFlight) {
  const buzzAge = Date.now() - Number(local.buzzStartedAt || 0);
  if (buzzAge > 3000) {
    console.warn(`Guard: buzz lock stale (${buzzAge}ms) — force releasing and retrying`);
    local.buzzToken = (local.buzzToken || 0) + 1;
    forceReleaseBuzzLock();  // ← إذا > 3 ثواني
  }
}
```
**متى**: عند محاولة buzz جديدة بينما buzz قديم معلق
**النتيجة**: playerBuzzInFlight = false + retry

#### المسار الرابع: عند تغيير الجولة من clearPlayerRoundState
```javascript
if (local.playerBuzzInFlight) {
  console.log("clearPlayerRoundState: clearing stale buzz lock from old round");
  local.buzzToken = (local.buzzToken || 0) + 1;
  forceReleaseBuzzLock();  // ← عند تغيير الجولة
}
```
**متى**: عند استدعاء clearPlayerRoundState من renderSession
**النتيجة**: playerBuzzInFlight = false

### 2️⃣ في `ui-renderer.js`:

#### المسار الخامس: عند تغيير الجولة من resetPlayerBuzzUiState
```javascript
if (local.playerUiRoundId !== currentRoundId) {
  console.log(`resetPlayerBuzzUiState: round changed (...), clearing state`);
  local.playerUiRoundId = currentRoundId;
  clearPlayerRoundState();  // ← يستدعي محلية clearPlayerRoundState()
}
```
الدالة المحلية:
```javascript
function clearPlayerRoundState() {
  local.buzzToken = (local.buzzToken || 0) + 1;
  local.playerBuzzInFlight = false;  // ← فك مباشر
  local.playerAttemptRoundId = null;
  local.lastPressTriggerAt = 0;
  local.buzzStartedAt = 0;
  if (local.buzzInflightTimer) {
    clearTimeout(local.buzzInflightTimer);
    local.buzzInflightTimer = null;
  }
  clearBuzzButtonDomLock();
}
```
**متى**: عند استدعاء resetPlayerBuzzUiState من renderSession
**النتيجة**: playerBuzzInFlight = false

#### المسار السادس: عند forceUnlockToken
```javascript
if (forceUnlockChanged) {
  console.log(`resetPlayerBuzzUiState: forceUnlockToken changed, clearing state`);
  local.lastSeenForceUnlockToken = Number(session.forceUnlockToken || 0);
  clearPlayerRoundState();  // ← نفس المحلية
}
```
**متى**: عند تفعيل forceUnlockToken من الخادم
**النتيجة**: playerBuzzInFlight = false

---

## ملخص:

### جميع المسارات تؤدي إلى نفس النتيجة:
✅ `playerBuzzInFlight = false`

### التسلسل الزمني:

| الوقت | الحدث | المسار | حالة |
|------|-------|--------|------|
| T+0 | buzz يبدأ | المسار 1/2 يُعِد | in_flight=true |
| T+2 | timeout | المسار 1 | in_flight=false |
| T+0-2 | request ينتهي | المسار 2 | in_flight=false |
| T+3 | buzz جديد بينما معلق | المسار 3 | in_flight=false |
| T+∞ | جولة جديدة (UI) | **المسار 5 (جديد)** | in_flight=false |
| T+∞ | جولة جديدة (controller) | المسار 4 | in_flight=false |
| T+∞ | forceUnlock | المسار 6 | in_flight=false |

---

## الإصلاح الجديد:

### قبل:
```
renderSession → clearPlayerRoundStateGuard (المسار 4 فقط)
              ↓
resetPlayerBuzzUiState (لم تُستدعَ)
```

### بعد:
```
renderSession → clearPlayerRoundStateGuard (المسار 4)
              → resetPlayerBuzzUiState (المسار 5 + 6 الجديد)
              ↓
ضمان فك القفل من جهتين!
```

---

## الاختبار:

### السيناريو الحرج:
```
1. buzz يبدأ → in_flight=true
2. request بطيء جداً (> 2 ثانية)
3. جولة تتغير قبل انتهاء request
   → clearPlayerRoundStateGuard (المسار 4)
   → resetPlayerBuzzUiState (المسار 5) ← جديد
   ↓
   ضمان in_flight=false
   الزر يصبح active ✓
```

### بدون الإصلاح:
```
جولة تتغير
→ clearPlayerRoundStateGuard فقط
  - تتحقق من playerBuzzInFlight
  - إذا كانت true، تفكها
  - لكن قد تكون متأخرة
```

### مع الإصلاح:
```
جولة تتغير
→ clearPlayerRoundStateGuard
  + resetPlayerBuzzUiState
  ↓
  double check ✓
```

