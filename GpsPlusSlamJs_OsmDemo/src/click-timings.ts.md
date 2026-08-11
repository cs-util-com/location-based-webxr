# `click-timings.ts`

## Purpose

Assembles the nine stages of one refresh pass from the three places they are
measured, and checks them against a separately measured whole.

## Public API

- `WorkerStageTimings` — `{ terrainWaitMs, meshMs, workerTotalMs }`, filled by
  the worker's `update` handler.
- `ClickTimingInput` — `{ radius, pipeline, worker, roundTripMs, drawMs }`.
- `composeClickTimings(input): ClickTimings` — the stages, their shares, the
  residual, and whether it reconciles.
- `describeClickTimings(t): string` — one console line per pass.

## Invariants & assumptions

- **Stage 8 (transfer) is DERIVED as `roundTripMs - workerTotalMs`, never
  timestamped across the boundary.** A dedicated worker has its own
  `performance.timeOrigin`, so subtracting a worker timestamp from a page one
  yields an offset rather than a duration. Every pre-existing timing in this
  demo is taken wholly inside the worker (`GeoEventStats`), so nothing warned
  about this — it is the first thing here to time across the boundary.
- **The residual is `wallMs - Σstages`, and it is never distributed.** Where
  the unmeasured time is _is the output_; renormalising the shares to close the
  gap would destroy the only signal the instrument exists to produce. The plan's
  own first draft missed a stage — the terrain join — that only a residual would
  have surfaced.
- **The residual means something sharper than "leftover", and it fell out of
  the algebra rather than being designed in.** Substituting the definitions
  leaves `workerTotal - (pipeline + terrainWait + mesh)`: page time cancels, so
  **a non-trivial residual points at the worker handler specifically** — which
  is exactly where the missed stage was hiding.
- **Shares are computed against the wall clock, never against the sum.** Against
  the sum they would always total 100 %, so a breakdown missing a third of the
  click would look complete.
- **A negative transfer is clamped AND flagged.** Clock skew or an
  over-reporting worker can make `roundTrip - workerTotal` negative; a negative
  stage would make the residual close by _cancelling_, so the sum would look
  right while two numbers were wrong. `reconciles: false` is what stops a
  ranking being read off it.
- The reconcile tolerance is 20 ms or 2 %, whichever is kinder. A zero tolerance
  would fail on every click and be ignored within a day, which is worse than not
  checking; this is far too tight to hide a stage.
- Pure — no clock, no I/O. That is what makes the arithmetic assertable with
  exact numbers, which is the half of the plan's testing mandate the
  source-level tests cannot reach.

## Examples

```ts
const timings = composeClickTimings({
  radius,
  pipeline: snapshot.timings,
  worker: workerTimings,
  roundTripMs,
  drawMs,
});
console.info(describeClickTimings(timings));
```

## Tests

`click-timings.test.ts` — the reconciliation identity, transfer derivation, the
negative clamp, shares-against-wall-clock, non-distribution of the residual, and
every branch of the console line including the DOES NOT RECONCILE warning.
