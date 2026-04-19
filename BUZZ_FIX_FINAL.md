# إصلاح مشكلة Buzz Button Deadlock - النسخة النهائية

## المشاكل المكتشفة والمحلولة

### 1. **try-finally الفارغة في triggerBuzz** ❌ → ✅
**المشكلة:** إذا رفعت `handleBuzzInput` exception، تبقى `playerBuzzInFlight = true` إلى الأبد
**الحل:** أضفنا `catch` block يفك القفل عند الخطأ

### 2. **shouldIgnoreDuplicateMobileTrigger في triggerBuzz تحجب ضغطات صحيحة** ❌ → ✅
**المشكلة:** 
- الفحص يمنع **جميع الضغطات** المتقاربة < 1000ms
- يحجب حتى لاعبين مختلفين يضغطان في نفس الوقت
- عندما لاعب 2 يسوي spam ثم ينتظر، الضغطة التالية تُحجب لأن `lastPressTriggerAt` من spam الأخير

**الحل:** 
- نقلنا الفحص من `triggerBuzz` إلى داخل `handleBuzzInput`
- الآن يُفحص فقط **بعد** ضبط `playerBuzzInFlight = true`
- لا يحجب ضغطات من لاعبين مختلفين

### 3. **debounce flag لا يُعاد تعيينه عند فشل buzz** ❌ → ✅
**المشكلة:** عند `claimBuzz(...) = false`، لا يتم reset `lastPressTriggerAt`
**الحل:** أضفنا `local.lastPressTriggerAt = 0` في مسار الفشل و catch block

### 4. **forceReleaseBuzzLock بدون token يسبب tangle** ❌ → ✅
**المشكلة:** استدعاءات قديمة بدون token قد تتصادم مع طلبات جديدة
**الحل:** تمرير `newToken` في جميع الاستدعاءات

## الترتيب الجديد الصحيح

```
triggerBuzz()
├─ Guard 1: playerBuzzInFlight = true? → return
├─ playerBuzzInFlight = true (ضبط فوري)
└─ handleBuzzInput()
   ├─ Guard 0: shouldIgnoreDuplicateMobileTrigger()? → fk القفل + return
   ├─ Guard 1: playerBuzzInFlight stale (>3s)? → فك بالقوة + retry
   ├─ Guard 2: بيانات اللاعب صحيحة؟
   ├─ Guard 3: playerAttemptRoundId = null؟
   ├─ await claimBuzz()
   │  ├─ ok=true: playerAttemptRoundId = roundId ✓
   │  └─ ok=false: playerAttemptRoundId = null, lastPressTriggerAt = 0 ✓
   └─ finally: forceReleaseBuzzLock(token)
      └─ playerBuzzInFlight = false, lastPressTriggerAt = 0
```

## السيناريوهات المحمية

### ✅ السيناريو 1: لاعب يضغط عادي
```
T0: يضغط → playerBuzzInFlight = true
T0.5: claimBuzz() → ok=true
T0.6: finally → playerBuzzInFlight = false ✓
```

### ✅ السيناريو 2: لاعب 1 يسبق + لاعب 2 يسوي spam
```
T0: لاعب 1 يضغط → playerBuzzInFlight = true → claimBuzz → ok=true
T5ms: لاعب 2 ضغطة 1 → playerBuzzInFlight = true? NO (لاعب 1 لم ينتهِ بعد)
      → دخول handleBuzzInput → claimBuzz → ok=false ✓
      → lastPressTriggerAt = 0 ✓
T6ms: لاعب 2 ضغطة 2 → playerBuzzInFlight = true? NO (جديد)
      → handleBuzzInput → claimBuzz → ok=false ✓
...
T500ms: لاعب 1 ينتهي → playerBuzzInFlight = false ✓
T600ms: الجولة تنتهي → playerAttemptRoundId = null ✓
T700ms: لاعب 2 يضغط في جولة جديدة → playerBuzzInFlight = false ✓
      → handleBuzzInput → Guard: playerAttemptRoundId = null → false ✓
      → claimBuzz → ok=true أو false ✓
```

### ✅ السيناريو 3: لاعبان يضغطان في نفس الوقت
```
T0: لاعب 1 يضغط
    → playerBuzzInFlight = false (لاعب 1)
    → playerBuzzInFlight = true
    → handleBuzzInput
T0.001ms: لاعب 2 يضغط (على جهاز آخر)
    → playerBuzzInFlight = false (لاعب 2)
    → playerBuzzInFlight = true
    → handleBuzzInput
    → كلاهما يصل claimBuzz()
    → الخادم يختار واحد ✓
```

### ✅ السيناريو 4: Network error أثناء buzz
```
T0: يضغط → playerBuzzInFlight = true
T0.5: claimBuzz() raises exception
    → catch: playerBuzzInFlight = false ✓
    → lastPressTriggerAt = 0 ✓
T1: ضغطة جديدة → playerBuzzInFlight = false ✓ → يعمل
```

### ✅ السيناريو 5: Timeout (>2s)
```
T0: يضغط → playerBuzzInFlight = true
T2s: timeout → forceReleaseBuzzLock(token) → playerBuzzInFlight = false ✓
T2.1s: ضغطة جديدة → يعمل ✓
```

## اختبر الآن

### اختبار يدوي على الجهاز:
1. **اختبر spam:** ادخل لاعب، ضغط سريع متكرر على الزر - يجب أن يعمل الزر بعد الانتهاء
2. **اختبت متزامن:** لاعبان يضغطان في نفس الوقت - يجب أن يرسل أحدهما على الأقل
3. **اختبر بعد الخسارة:** لاعب يخسر وسوي spam، الجولة الجديدة تبدأ - يجب أن يستطيع الضغط
4. **اختبر network error:** قطع الإنترنت أثناء buzz - الزر يجب أن يفك آلياً

## ملفات معدلة
- `js/player-controller.js`: تحديثات شاملة على الأقفال والحارسات
- `js/ui-renderer.js`: دوال تنظيف مُحسّنة عند تغيير الجولة
