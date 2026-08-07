# Write Failure Tracker

## Purpose

Tracks consecutive file write failures during recording sessions and warns users
when storage may be unavailable (e.g., disk full, permission revoked).

Addresses **Field Test Readiness Issue #7**: Silent image write failures.

## Public API

### `createWriteFailureTracker(config)`

Factory function that creates a tracker instance.

**Parameters:**

- `config.onWarning` (required): `(message: string) => void` - Callback to show warning to user
- `config.failureThreshold` (optional): `number` - Consecutive failures before warning (default: 3)

**Returns:** the framework's generic `FailureTracker`.

This module is a **named preset**, not a wrapper: it supplies four config values
(`label: 'WriteFailure'`, the warning message, `defaultThreshold: 3`,
`logLevel: 'error'`) to `createFailureTracker` and returns the result unchanged.
**There is no `WriteFailureTracker` type** — it existed until 2026-07-30 as a
re-declaration of `FailureTracker` with all five methods hand-forwarded, which
also made this file a near-copy of the framework's capture preset. Import the
type from `gps-plus-slam-app-framework/utils/failure-tracker`.

### `FailureTracker` (the returned shape)

| Method                  | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `recordSuccess()`       | Reset failure counter (call after successful write) |
| `recordFailure(error?)` | Increment counter and warn if threshold exceeded    |
| `getFailureCount()`     | Get current consecutive failure count               |
| `hasWarned()`           | Check if warning has been shown                     |
| `reset()`               | Reset all state (call when starting new session)    |

`error` is optional on the shared type, but **this preset logs at `error` level
and includes it** — pass the causing error. Convention, not a type constraint.

### Exported Constants

- `DEFAULT_TRACKER_CONFIG`: Default threshold configuration (3 — deliberately
  lower than the capture preset's 5, because a failed write loses data while a
  missed capture only degrades one)
- `WRITE_FAILURE_WARNING`: User-facing warning message

## Invariants & Assumptions

1. **Warning shown only once per session** - Avoids spamming the user
2. **Success resets counter but not warning flag** - Transient recovery doesn't re-arm warning
3. **reset() re-arms the warning** - New sessions get fresh warning capability
4. **Threshold must be >= 1** - At least one failure required before warning

## Usage Example

```typescript
import { createWriteFailureTracker } from './write-failure-tracker';
import { showError } from '../ui/hud';

// Create tracker at recording start
const writeTracker = createWriteFailureTracker({
  onWarning: showError,
  failureThreshold: 3, // optional
});

// Use with async writes
writeFrame(blob, index)
  .then(() => writeTracker.recordSuccess())
  .catch((err) => writeTracker.recordFailure(err));

// Reset at session end
writeTracker.reset();
```

## Tests

Covered by `write-failure-tracker.test.ts` (14 tests):

- Initial state verification
- Success resets counter but not warning flag
- Failure increments counter and warns at threshold
- Warning shown only once per session
- Custom threshold configuration
- Reset allows re-warning in new sessions
- Mixed success/failure sequences

## Dependencies

- `../utils/failure-tracker` - Generic failure tracker factory (handles counting, threshold, and logging)
- `../utils/logger` - Used indirectly via the generic factory
