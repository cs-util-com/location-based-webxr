# `click-timings.ts`

## Purpose

Assembles the nine stages of one refresh pass from the three places they are
measured, checks them against a separately measured whole, and does the same for
the whole click across its rings.

## Public API

- `WorkerStageTimings` —
  `{ terrainWaitMs, meshMs, prefetchMs, queueMs, workerTotalMs }`, filled by the
  worker's `update` handler.
- `ClickTimingInput` — `{ radius, pipeline, worker, roundTripMs, drawMs }`.
- `composeClickTimings(input): ClickTimings` — the stages, their shares, the
  residual, and whether it reconciles.
- `describeClickTimings(t): string` — one console line per ring. Its
  `served` prefix reads `<fetched>/<net>/<cache>[/<unmeasured>]/<held>/<features>`.
  - **`featuresHeld` is printed even when zero** (added 2026-08-31), unlike the
    zero-cost stages, which are filtered out. Absent and zero are different
    facts everywhere else in this type, and a missing count on an empty pass
    would read as "the instrument is not there" — the one misreading that would
    waste a measurement session. Rationale for the field itself is in
    [`demo-pipeline.ts.md`](./demo-pipeline.ts.md).
- `ClickSummary` — `{ clickMs, rings, ringSumMs, pageResidualMs }`.
- `composeClickSummary(clickMs, rings): ClickSummary` — the whole click against
  the sum of its rings.
- `describeClickSummary(s): string` — one console line per click, printed after
  the ring lines.

## Invariants & assumptions

**This section is normative and current.** It previously stated the pre-split
design while a "corrections" section below withdrew it, so a reader who
consulted the invariants — where an invariant is supposed to live — met the
retracted claim and only a reader who scrolled past the tests found out it was
dead. Superseded reasoning is now kept as history at the bottom and never as an
invariant.

- **Stage 8 is DERIVED as `roundTripMs − queueMs − workerTotalMs`, never
  timestamped across the boundary.** It is called `boundary` because it is only
  the reply's structured clone and its delivery. A dedicated worker has its own
  `performance.timeOrigin`, so subtracting a raw worker `now()` from a page one
  yields an offset rather than a duration; a single-sided duration needs no
  shared origin at all, which is why deriving it is the default.
- **`queue` is its OWN stage**, measured post-to-dispatch over
  `performance.timeOrigin + now()` — an absolute timeline both sides share. This
  matters because the demo posts `loadTerrain` and `refresh` to the SAME worker
  in the same tick (W3), so on a new position the concurrent DEM job's CPU used
  to land in `boundary` and read as clone cost.
- **The residual is `wallMs − Σstages`, and it is never distributed.** Where the
  unmeasured time is _is the output_; renormalising the shares to close the gap
  would destroy the only signal the instrument exists to produce. The plan's own
  first draft missed a stage — the terrain join — that only a residual would
  have surfaced.
- **The residual means something sharper than "leftover", and it fell out of the
  algebra rather than being designed in.** Substituting the definitions leaves
  `workerTotal − (Σpipeline stages + terrainWait + mesh + prefetch)`: page time
  and `queue` cancel, so **a non-trivial residual points at the worker handler
  specifically** — which is exactly where the missed stage was hiding.
  - `prefetch` belongs in that identity and was omitted from it in three places
    at once. A term added to the stage list has to reach the algebra in the same
    commit.
- **Shares are computed against the wall clock, never against the sum.** Against
  the sum they would always total 100 %, so a breakdown missing a third of the
  click would look complete.
- **Every stage is clamped at zero, and a clamp means the line does NOT
  reconcile.** A negative stage would make the residual close by _cancelling_ —
  the sum would look right while two numbers were wrong. Clamping fixes the
  arithmetic; the `reconciles: false` is what stops a ranking being read off a
  pass whose producer contradicted its own clock. Both the derived boundary and
  the measured inputs are covered.
- The reconcile tolerance is 20 ms or 2 %, whichever is kinder. A zero tolerance
  would fail on every click and be ignored within a day, which is worse than not
  checking; this is far too tight to hide a stage.
- **`pageResidualMs` is the only clock in the instrument that can see page
  time.** The per-ring algebra cancels it by construction, so a page-side stage
  nobody enumerated can surface here and nowhere else. That is why
  `refresh-cycle.ts` opens the click clock BEFORE its `fetchStarted` dispatch:
  a synchronous dispatch with subscriber renders behind it is exactly such a
  stage.
- Pure — no clock, no I/O. That is what makes the arithmetic assertable with
  exact numbers, which is the half of the plan's testing mandate the
  source-level tests cannot reach.

## Examples

```ts
const rings: ClickTimings[] = [];
for (const radius of PROGRESSIVE_RADII) {
  const ring = composeClickTimings({
    radius,
    pipeline: snapshot.timings,
    worker: workerTimings,
    roundTripMs,
    drawMs,
  });
  rings.push(ring);
  console.info(describeClickTimings(ring));
}
console.info(describeClickSummary(composeClickSummary(clickMs, rings)));
```

## Tests

`click-timings.test.ts` — the reconciliation identity, the boundary derivation
(with a NON-ZERO queue, so the split is actually exercised), the negative clamp
and its effect on `reconciles`, shares-against-wall-clock, non-distribution of
the residual, every branch of the console line including the DOES NOT RECONCILE
warning, and the page-side half: `composeClickSummary`'s normal case, its clamp,
its zero-length click, and `pipelineUnattributedMs`.

`click-timings.property.test.ts` — the four absolute claims over arbitrary and
adversarial inputs.

`refresh-cycle.test.ts` pins that the click clock opens before the
`fetchStarted` dispatch, by burning real time in a store subscriber.

## Superseded reasoning, kept as history

These were once stated as invariants above. They are wrong and are recorded so
they are not re-derived — **not as guidance.**

- ~~"`boundary` contains the queue, and neither side can separate the two
  without a shared clock."~~ Asserted in five places and false:
  `performance.timeOrigin` is exposed in a dedicated worker as well as on the
  page and is an ABSOLUTE origin, so `timeOrigin + now()` is a common timeline —
  which is what `timeOrigin` is for. The overstatement was declaring the split
  impossible, in a doc series whose subject is not asserting unchecked things.
- ~~"Stage 8 is `roundTripMs − workerTotalMs`."~~ Pre-split derivation.
- ~~"A negative _transfer_ is clamped."~~ The `transfer` name was retired in
  favour of `boundary`, because calling it "transfer" sends the next reader to
  look at clone size for a cost that is really a busy thread.
- ~~"The residual is `workerTotal − (pipeline + terrainWait + mesh)`."~~ Omits
  `prefetch`.

## Other corrections made after review

- **Zeros are no longer dropped indiscriminately.** The nine stages §2
  enumerates print even at zero; only the sub-splits of stages 1–2 drop. Two of
  those zeros are the answer: `parse` is genuinely 0 on a cache hit and
  `terrain-wait` is 0 on a widening ring, and those are exactly what
  discriminates the plan's competing predictions about which stage owns the
  wait.
- **`reconciles` is false for a zero-wall pass.** An instrument that measured
  nothing must not report that its nothing adds up.
- **`fetchUnattributedMs` was added**, because §10.2 of the plan justified
  deferring the milestone-1 cache-probe gap on the grounds that `fetchMs` minus
  the parts would expose it — and the first cut produced `fetchMs` and
  subtracted nothing from it anywhere.
- **Shares are rounded independently and the line says so.** With this many
  entries the column can miss 100 by a few points, and a reader who adds it up
  would otherwise reasonably conclude the instrument is broken.
- **`ClickSummary` is new**, because the per-ring residual cancels page time out
  by construction and therefore could never surface a page-side stage nobody
  enumerated — the exact class of defect this instrument was built after
  missing. `pageResidualMs` is that gap.
