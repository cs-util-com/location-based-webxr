# capture-failure-tracker.ts

## Purpose

A preset of the generic [`utils/failure-tracker`](../utils/failure-tracker.ts.md)
for **image-capture** failures: count consecutive failures and warn the user
once when they cross a threshold, so a phone silently failing to capture frames
(typically low memory) does not produce a recording that only looks fine.

Field Test Readiness Issue #11 — silent image-capture failures.

## Public API

### `createCaptureFailureTracker(config): FailureTracker`

`config.onWarning` is required; `config.failureThreshold` optionally overrides
the default. Preset applied to the generic factory:

- `label: 'CaptureFailure'` (log prefix)
- `warningMessage: CAPTURE_FAILURE_WARNING`
- `defaultThreshold: 5`
- `logLevel: 'warn'`

The return type is the generic
[`FailureTracker`](../utils/failure-tracker.ts.md) — `recordSuccess()` /
`recordFailure(error?)` / `getFailureCount()` / `hasWarned()` / `reset()`.
**There is no `CaptureFailureTracker` type**: it existed until 2026-07-30 as a
re-declaration of `FailureTracker`, with all five methods hand-forwarded. A
preset should configure the generic thing, not restate its shape.

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
- **`recordFailure`'s error argument is optional and unused here.** The capture
  call site (`recordCaptureFailure()`) passes nothing, and `logLevel: 'warn'`
  means the preset logs a count without an error. The write preset passes and
  logs one. Both are the same type now, so this is a convention, not a
  constraint.

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

## Sibling preset

The recorder's `storage/write-failure-tracker.ts` is the other preset of the
same factory (threshold 3, `logLevel: 'error'`). The two used to be ~30 lines of
identical boilerplate each; both were reduced to config-only on 2026-07-30. If a
third preset appears, it belongs next to whichever package owns its call site —
and it should stay a config-only factory returning `FailureTracker`.
