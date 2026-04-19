# ✅ الحل للمشكلة الثانية

## المشكلة:
```
لاعب 1 يضغط → لاعب 2 يسوي spam
→ بعض طلبات spam تمر (يرى "سبقك لاعب")
→ الزر يعلق
```

## السبب:
في `bindBuzzButtonEvents()`, الـ guard الموجودة **داخل** `handleBuzzInput` قد تكون **بطيئة جداً**.

عندما يضغط لاعب 2 spam:
```
الضغطة 1: يصل إلى handleBuzzInput
الضغطة 2: نفس الوقت تقريباً → قد تصل قبل playerBuzzInFlight يُضبط
الضغطة 3: قد تصل أيضاً
```

## الحل:
إضافة **guard فوري** قبل `handleBuzzInput`:

```javascript
const triggerBuzz = async (event) => {
  // ✅ guard سريعة جداً (قبل handleBuzzInput)
  if (local.playerBuzzInFlight) {
    console.warn(`buzz already in flight — ignoring`);
    return;  // ← حجب فوري!
  }
  
  // بقية الكود
  await handleBuzzInput();
}
```

## كيف يعمل:

```
T0: لاعب 1 ضغط
    → playerBuzzInFlight = true
    → يرسل claimBuzz

T0.1: لاعب 2 ضغط 1
      → triggerBuzz فحصت playerBuzzInFlight
      → true! → حجب فوري ✓

T0.2: لاعب 2 ضغط 2
      → triggerBuzz فحصت playerBuzzInFlight
      → true! → حجب فوري ✓

...

T2: response → finally → playerBuzzInFlight = false
```

## الملف المعدل:
- `js/player-controller.js` (bindBuzzButtonEvents، السطور 378-382)

## النتيجة المتوقعة:
✅ لاعب 2 spam يُحجب فوراً
✅ الزر لن يعلق
✅ لن يرى رسالة "سبقك لاعب" (لأن الطلبات لن تمر)
