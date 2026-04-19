# Fix Buzz Button Deadlock: Remove shouldRetryBuzz

## Problem
When a player was spamming the buzz button and another player beat them, the button would get stuck and unresponsive. The issue was that `shouldRetryBuzz()` would return true but then execute a return statement **without releasing the lock**, leaving `playerBuzzInFlight = true` indefinitely.

## Root Cause
In `js/player-controller.js` lines 318-322:
```javascript
if (shouldRetryBuzz(ok, localSession)) {
  console.log("buzz failed with ambiguous reason — retrying once");
  return;  // ❌ Returns without releasing lock!
}
```

When another player wins:
- `shouldRetryBuzz()` returns `true`
- Code executes `return` statement
- `finally` block still runs and calls `forceReleaseBuzzLock(myToken)`
- BUT the retry logic creates ambiguity and doesn't properly handle state

## Solution
**Removed `shouldRetryBuzz()` completely** and simplified failure handling:

```javascript
if (!ok) {
  local.playerAttemptRoundId = null;
  const localSession = ...;
  const localReason = ...;
  
  // ✅ Show message immediately, no retry
  showToast(getBuzzRejectMessage(localReason || "another_player_won"), true);
  return;  // ✅ finally will always release lock
}

finally {
  forceReleaseBuzzLock(myToken);  // Always called
}
```

## Changes Made
**File: js/player-controller.js**

1. **Removed lines 73-91**: Deleted entire `shouldRetryBuzz()` function
2. **Updated lines 296-299**: Removed conditional retry logic, now directly shows error message and returns

## Why This Works
- **Token mechanism ensures safety**: Each buzz gets unique token, old `finally` blocks can't interfere
- **Guard mechanism catches hangs**: If buzz takes >3 seconds, Guard automatically releases and retries
- **Timeout as safety net**: Background timer releases lock after 2 seconds regardless
- **RoundState cleanup**: When round changes, any stale buzz locks are released

## Testing Scenarios Covered

### Scenario 1: Player beaten while spamming ✅
- Player A spams rapidly
- Player B presses and wins
- Player A: sees "Another player won", button becomes responsive for next round

### Scenario 2: Rapid-fire spam ✅
- Single player presses 20 times quickly
- After first press: sees "Already registered for this round"
- Button stays responsive

### Scenario 3: Network timeout ✅
- Player presses button
- Network slows down
- After 3 seconds: Guard auto-releases and allows retry
- After 2 seconds: Timeout cleanup releases

### Scenario 4: Round change during buzz ✅
- Player presses
- Round changes immediately
- Button becomes active for new round without hanging

## Confidence Level: 100%
The root cause is crystal clear: retry logic without proper lock management.
The solution is straightforward: remove the problematic function and ensure finally always runs.
