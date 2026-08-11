# `click-timings.ts`

## Purpose

Assembles the nine stages of one refresh pass from the three places they are
measured, and checks them against a separately measured whole.

## Public API

- `WorkerStageTimings` — `{ terrainWaitMs, meshMs, prefetchMs, workerTotalMs, queueMs }`, filled by
  the worker's `update` handler.
- `ClickTimingInput` — `{ radius, pipeline, worker, roundTripMs, drawMs }`.
- `composeClickTimings(input): ClickTimings` — the stages, their shares, the
  residual, and whether it reconciles.
- `describeClickTimings(t): string` — one console line per pass.

## Invariants & assumptions

- **Stage 8 is DERIVED as `roundTripMs - workerTotalMs`, never
  timestamped across the boundary — and it is called `boundary`, not
  `transfer`, because it contains the structured clone in both directions PLUS
  any time the `update` message spent QUEUED. The demo posts `loadTerrain` and
  `refresh` to the SAME worker in the same tick (W3), so on a new position the
  concurrent DEM job's CPU lands here. Neither side can separate the two
  without a shared clock, so the name says what the number contains.** A
  dedicated worker has its own
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

## Corrections made after review

- **`transfer` → `boundary`.** The number is everything in the round trip the
  worker's clock does not cover: the structured clone _and_ any time the message
  spent queued. Since `main.ts` posts the terrain load and the refresh to the
  same worker in the same tick, on a new position the concurrent DEM job's CPU
  lands in this term. Calling it "transfer" would send the next reader to look
  at clone size for a cost that is really a busy thread.
- **Zeros are no longer dropped indiscriminately.** The nine stages §2
  enumerates print even at zero; only the sub-splits of stages 1–2 drop. Two of
  those zeros are the answer: `parse` is genuinely 0 on a cache hit and
  `terrain-wait` is 0 on a widening ring, and those are exactly what
  discriminates the plan's competing predictions about which stage owns the
  wait.
- **`reconciles` no longer uses `Math.abs`, and is false for a zero-wall pass.**
  Stages summing to MORE than the whole means something is double-counted, which
  is no more trustworthy than something missing; and an instrument that measured
  nothing must not report that its nothing adds up.
- **`fetchUnattributedMs` was added**, because §10.2 of the plan justified
  deferring the milestone-1 cache-probe gap on the grounds that `fetchMs` minus
  the parts would expose it — and the first cut produced `fetchMs` and
  subtracted nothing from it anywhere.
- **Every stage is clamped, not just the derived one.** A property run over
  adversarial inputs found `prefetch-queue` passing a negative through.
- **Shares are rounded independently and the line says so.** With this many
  entries the column can miss 100 by a few points, and a reader who adds it up
  would otherwise reasonably conclude the instrument is broken.

## Corrections from the whole-branch review

- **"The queue and the clone cannot be separated without a shared clock" was
  WRONG, and it was asserted in five places.** `performance.timeOrigin` is
  exposed in a dedicated worker as well as on the page and is an ABSOLUTE
  origin, so `timeOrigin + now()` is a common timeline — which is what
  `timeOrigin` is for. `queue` is now its own stage, measured post-to-dispatch,
  and `boundary` means only the reply's clone. Deriving stage 8 rather than
  timestamping it is still the default, because a single-sided duration needs
  no shared origin at all; the overstatement was declaring the split
  impossible, in a doc series whose subject is not asserting unchecked things.
- **The residual identity omitted `prefetch`** here, in the module header and in
  the plan — and the test that "pinned" it omitted the term too, passing only
  because its fixture set `prefetchMs: 0`. A term added to the stage list has to
  reach the algebra in the same commit.
- **`ClickSummary` is new**, because the per-ring residual cancels page time out
  by construction and therefore could never surface a page-side stage nobody
  enumerated — the exact class of defect this instrument was built after
  missing. `pageResidualMs` is that gap.
