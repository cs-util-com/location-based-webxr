# Failure Tracker (Generic Factory)

## Purpose

Reusable factory for creating consecutive-failure trackers with threshold-based
user warnings. Extracted from the shared pattern in `capture-failure-tracker` and
`write-failure-tracker`.

## Public API

### `createFailureTracker(config): FailureTracker`

Creates a new tracker instance.

**Config (`FailureTrackerConfig`):**

| Option             | Type                      | Required | Description                               |
| ------------------ | ------------------------- | -------- | ----------------------------------------- |
| `label`            | string                    | yes      | Logger tag and log message prefix         |
| `warningMessage`   | string                    | yes      | Message passed to `onWarning`             |
| `defaultThreshold` | number                    | yes      | Threshold when `failureThreshold` omitted |
| `onWarning`        | (message: string) => void | yes      | Callback for threshold notification       |
| `failureThreshold` | number                    | no       | Overrides `defaultThreshold`              |
| `logLevel`         | `'warn'` \| `'error'`     | no       | Logging severity (default: `'warn'`)      |

### `FailureTracker` interface

| Method                  | Returns | Description                                       |
| ----------------------- | ------- | ------------------------------------------------- |
| `recordSuccess()`       | void    | Reset consecutive failure counter                 |
| `recordFailure(error?)` | void    | Increment counter, log, warn if threshold reached |
| `getFailureCount()`     | number  | Current consecutive failure count                 |
| `hasWarned()`           | boolean | Whether warning has been shown this session       |
| `reset()`               | void    | Reset all state (counter + warned flag)           |

## Invariants & Assumptions

- Warning fires **once** per session (until `reset()`).
- `recordSuccess()` resets the counter but not the `hasWarned` flag.
- `reset()` clears both counter and `hasWarned`, allowing re-warning.
- `logLevel: 'error'` logs the error object; `'warn'` logs only the count.

## Examples

```typescript
import { createFailureTracker } from '../utils/failure-tracker';

const tracker = createFailureTracker({
  label: 'MyTracker',
  warningMessage: 'Too many failures!',
  defaultThreshold: 3,
  onWarning: (msg) => showToast(msg),
});

tracker.recordFailure(); // count=1
tracker.recordFailure(); // count=2
tracker.recordFailure(); // count=3 → onWarning called
tracker.recordFailure(); // count=4 → no second warning
tracker.recordSuccess(); // count=0, hasWarned=true
tracker.reset(); // count=0, hasWarned=false
```

## Tests

`failure-tracker.test.ts` — 12 tests covering:

- Initial state
- Failure counting and threshold triggering
- Once-only warning semantics
- Success/reset behavior
- Optional error argument
- configurable logLevel
