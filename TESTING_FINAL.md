# اختبار السيناريو الحرج: لاعب سبقك أثناء spam + تغيير جولة

## الهدف:
التأكد من أن الزر **لا يعلق** عند:
1. لاعب 1 يضغط
2. لاعب 2 يسوي spam
3. لاعب 2 يسبقك
4. انتهاء الجولة + جولة جديدة

## الخطوات الفعلية:

### قبل البدء:
افتح DevTools (F12) وانسخ هذا في Console:
```javascript
// مراقب تفصيلي
(function() {
  window._buzz = {
    log: (msg) => console.log(`[BUZZ] ${msg}`),
    state: () => ({
      inFlight: local.playerBuzzInFlight,
      token: local.buzzToken,
      roundId: local.playerUiRoundId,
      attemptRoundId: local.playerAttemptRoundId,
      time: new Date().toLocaleTimeString()
    })
  };
  
  // طباعة الحالة كل 500ms
  setInterval(() => {
    if (local.playerBuzzInFlight !== window._buzz.lastInFlight) {
      window._buzz.lastInFlight = local.playerBuzzInFlight;
      console.table(window._buzz.state());
    }
  }, 500);
})();

// دالة اختبار سريعة
function testBuzzState() {
  console.table(window._buzz.state());
}
```

### الاختبار:

#### 1️⃣ نافذة لاعب 1:
```
- اسم: لاعب 1
- فريق: الأزرق
- اضغط زر الضغط (buzz)
- سيرسل request للخادم
```

#### 2️⃣ نافذة لاعب 2:
```
- اسم: لاعب 2
- فريق: الأزرق (نفس الفريق)
- اضغط الزر 10 مرات بسرعة (spam)
```

#### 3️⃣ اختبر في Console:
```javascript
testBuzzState()
// يجب أن ترى:
// inFlight: false (بعد لحظة من spam لاعب 2)
// roundId: 1 (أو أي رقم جولة)
```

#### 4️⃣ من صفحة host:
```
- اضغط "جولة جديدة" أو دع الوقت ينتهي
```

#### 5️⃣ في نافذة لاعب 1:
```
- الزر يجب أن يصبح active
- اضغطه مرة أخرى
- يجب أن يعمل بدون مشاكل
```

## ما يجب مراقبته في Console:

### ✅ السجلات الصحيحة:
```
resetPlayerBuzzUiState: round changed (1 → 2), clearing state
✅ clearPlayerRoundState: buzz lock released
clearPlayerRoundState: clearing old round (1) for new round (2)
clearPlayerRoundState: clearing stale buzz lock from old round
forceReleaseBuzzLock: myToken=X
[BUZZ] inFlight: false ← القيمة الأهم!
```

### ❌ السجلات التي تشير لمشكلة:
```
[BUZZ] inFlight: true  ← الزر معلق!
// + لا ترى أي استدعاء clearPlayerRoundState
```

## الفحوصات النهائية:

1. **بعد spam لاعب 2**:
   ```javascript
   local.playerBuzzInFlight === false  // ✅ يجب true
   ```

2. **بعد تغيير الجولة**:
   ```javascript
   local.playerAttemptRoundId === null  // ✅ يجب null
   local.lastPressTriggerAt === 0      // ✅ يجب 0
   ```

3. **اختبر الضغطة في الجولة الجديدة**:
   - الزر يجب أن يستجيب فوراً
   - لا يعلق أبداً

## الملفات المعدلة:

| ملف | التغيير |
|-----|---------|
| `js/ui-renderer.js` | استدعاء `resetPlayerBuzzUiState(session)` من `renderSession` |
| `js/ui-renderer.js` | إضافة logging في `clearPlayerRoundState` و `resetPlayerBuzzUiState` |
| `js/player-controller.js` | إضافة `buzzStartedAt = 0` في `clearPlayerRoundState` |

## النقاط الرئيسية:

### المشكلة الأصلية:
`resetPlayerBuzzUiState()` **لم تكن تُستدعى من أي مكان!**

### الحل:
استدعاؤها من `renderSession()` لضمان تنظيف الحالة عند:
1. تغيير الجولة
2. تفعيل `forceUnlockToken`

### الآلية:
```
renderSession() → resetPlayerBuzzUiState(session)
  ↓
تحقق من playerUiRoundId ≠ currentRoundId
  ↓
استدعِ clearPlayerRoundState()
  ↓
فك playerBuzzInFlight ✅
```
