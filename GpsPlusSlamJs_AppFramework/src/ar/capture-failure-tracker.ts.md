# capture-failure-tracker.ts

## Purpose

A preset of the generic [`utils/failure-tracker`](../utils/failure-tracker.md)
for **image-capture** failures: count consecutive failures and warn the user
once when they cross a threshold, so a phone silently failing to capture frames
(typically low memory) does not produce a recording that only looks fine.

Field Test Readiness Issue #11 — silent image-capture failures.

## Public API

### `createCaptureFailureTracker(config): CaptureFailureTracker`

`config.onWarning` is required; `config.failureThreshold` optionally overrides
the default. Preset applied to the generic factory:

- `label: 'CaptureFailure'` (log prefix)
- `warningMessage: CAPTURE_FAILURE_WARNING`
- `defaultThreshold: 5`
- `logLevel: 'warn'`

### `CaptureFailureTracker`

`recordSuccess()` / `recordFailure()` / `getFailureCount()` / `hasWarned()` /
`reset()`.

### `DEFAULT_CAPTURE_TRACKER_CONFIG`

`{ failureThreshold: 5 }`. **Higher than the write tracker's 3 on purpose:** a
missed frame degrades the capture, whereas a failed write loses data, so capture
tolerates more consecutive failures before nagging.

### `CAPTURE_FAILURE_WARNING`

The user-facing string — names a likely cause and needs no technical context.

## Invariants & assumptions

- **Consecutive, not cumulative.** `recordSuccess()` resets the counter; only an
  unbroken run reaches the threshold.
- **Warns once per session.** `hasWarned()` latches until `reset()`, so a
  persistently failing device produces one warning, not one per frame.
- **`recordFailure()` takes no argument here**, while the generic tracker's
  `recordFailure(error?)` and the recorder's write tracker both accept one. The
  narrowing is intentional at the call site — capture failures are counted, not
  diagnosed — but it does mean the two trackers are not interchangeable.

## Example

```ts
const tracker = createCaptureFailureTracker({ onWarning: showError });

try {
  await captureFrame();
  tracker.recordSuccess();
} catch {
  tracker.recordFailure(); // 5 in a row → showError(CAPTURE_FAILURE_WARNING), once
}
```

## Tests

`capture-failure-tracker.test.ts` — 9 tests: threshold behaviour, the reset on
success, warn-once latching, the custom-threshold override, and `reset()`.
Threshold mechanics themselves are pinned once in `failure-tracker.test.ts`.

## Known duplication (not a defect in this file alone)

This module and the recorder's `storage/write-failure-tracker.ts` are the same
~30 lines twice: each re-declares an interface structurally equivalent to
`FailureTracker` and then hand-forwards all five methods to the object
`createFailureTracker` already returned. Only four values actually differ
(`label`, message, default threshold, log level) plus the `recordFailure`
signature above. A preset should be a config object or a one-line factory, not a
re-declared type plus a forwarding layer. Filed in the simplify-loop findings
doc — do not fix it in one package only, since the point is that the two are
duplicates of each other across the repo boundary.
