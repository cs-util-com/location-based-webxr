# frame-attribution.ts

## Purpose

The frame recorder's attribution join: which events (an E step, a model
load, a new shader program, a band edge) are over-represented in slow
frames. Globe zoom performance plan
`GpsPlusSlamJs_Docs/docs/2026-10-03-2017-globe-zoom-frame-hitches-performance-plan.md`
§4.1 "Attribution rule" (stated before measuring), review Major 5, PERF-0.

## Public API

- Declared parameters (plan §4.3): `ATTRIBUTION_KS` `[3, 5, 10]`,
  `ATTRIBUTION_LAGS` `[0, 1, 2]` frames, `ATTRIBUTION_MIN_HITCH_FRAMES` 5.
- `createHitchAttribution({ thresholdsMs?, lags? })`:
  - `endFrame(intervalMs, events): boolean` - one call per frame, with the
    names of the events that fell in it. `false` for a non-finite or
    negative interval: that frame (its events too) is refused and counted
    in `rejected`. Empty names are ignored; a name counts once per window
    however often it fired.
  - `counts(): AttributionCounts` - plain data: `thresholdsMs`, `lags`
    (both ascending), `frames`, `rejected`, `hitchFrames[threshold]`,
    `kinds[name].inHitch[threshold][lag]` and `.inNormal[threshold][lag]`.
- `poolAttributionCounts(runs)` - the counts of several runs added (the
  three repeats of a sweep cell, or a whole sweep). `RangeError` for an
  empty list or runs counted at different thresholds or lags.
- `attributionVerdicts(counts, { ks?, minHitchFrames? }): CauseVerdict[]` -
  per event kind: every threshold x lag x k `CauseCell` (`inHitch`,
  `inNormal`, `ratio`, `supported`), `supportedCells` / `totalCells`, and
  `status` (`supported` at every cell, `provisional` at some,
  `unsupported` at none). Strongest first: supported cells, then hitch
  frames with the event at the lowest threshold and widest lag, then name.
- `RangeError` for empty, negative or non-finite options, non-integer lags,
  `k <= 0`, or a negative or non-integer `minHitchFrames`.

## Invariants & assumptions

- **The rule, as the plan states it:** an event counts for a frame when it
  fell in that frame or in the `lag` frames before it (an E step's load
  wave and a promise continuation land a frame or two after their cause).
  A cell is supported when the event's rate among hitch frames is at least
  `k` times its rate among normal frames AND it is in at least
  `minHitchFrames` hitch frames (two coincidences never make a cause).
- **A hitch frame** is one whose interval is strictly over the threshold;
  every other accepted frame is normal. `hitchFrames` equals the
  histogram's `over` counts when both see the same frames (`frame-run.ts`
  tests it).
- **Ratio:** `Infinity` when the event was never in a normal frame;
  `null` (unsupported) when there are no hitch frames or no normal frames
  at that threshold, because the comparison is undefined.
- **A larger k can only remove support** (property test).
- **Streaming, constant memory per kind:** only the last `max(lag)` frames'
  event sets are kept; a 26,000-frame run costs a table of counts.
- **Pooling is a sum,** not a run over concatenated frames: each run's lag
  windows stop at its own first frame (the two agree at lag 0, property
  test).
- Per-frame cost: two small sets and one counter update per (kind in the
  window, threshold, lag); the recorder's overhead is to be measured in
  PERF-1 against its run-to-run noise (plan §4.1 "Its own cost").

## Examples

```ts
const join = createHitchAttribution();
join.endFrame(dtMs, ['e-step', 'load-model:relief']); // each frame
const verdicts = attributionVerdicts(join.counts());
verdicts[0]; // { kind: 'e-step', status: 'provisional', supportedCells: 18, ... }
```

## Tests

`frame-attribution.test.ts`: the declared parameters; hitch counts per
threshold; the lag join golden case; one count per window; refused frames
and empty names; option refusals; a brute-force recount of the rule
(property, swept lags); pooling (golden, equal to a concatenated run at
lag 0 as a property, refusals); a supported, an unsupported (background)
and a provisional cause, the minimum hitch frames swept 3 / 5 / 8, the
infinite and the undefined ratio, verdict option refusals, monotone in k
(property).
