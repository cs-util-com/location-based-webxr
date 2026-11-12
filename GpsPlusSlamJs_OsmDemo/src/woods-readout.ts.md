# `woods-readout.ts`

## Purpose

The woods governor's link knobs and its `?perf=1` frame readout for OsmDemo: the knobs that switch the phone's automatic woods thinning off and pick the tree form, and a line showing the frame time and what the governor did. Pure apart from the governor it wraps: the view supplies the times and counts, the sentence is built here, so it is pinned without a GPU.

## Public API

- `readWoodsKnobs(search, coarsePointer)` returns `{ auto, treeForm, perf }`:
  - `auto`: a coarse pointer (a phone) and not `woodsauto=off`.
  - `treeForm`: `"trunk"` for `treeform=trunk`, otherwise `"crown"` (an unknown value opens the default).
  - `perf`: `perf=1`.
- `createFrameWindow(windowMs = 10000)`: `add(atMs, ms)` keeps the intervals of the last `windowMs` (non-positive or non-finite ignored); `p95()` is the nearest-rank 95th percentile, undefined while empty.
- `describeWoodsReadout({ averageMs, p95Ms, share, mode, inventedTrees, drawCost })`: one line, e.g. `frame 61.2 ms · p95 88.0 ms · woods 50 % (thinned) · 1,234 invented trees · 120 draws / 456,789 tri`; `-` for an unmeasured time, the cost dropped while unmeasured (`describeDrawCost`).
- `createWoodsMeter(auto)`: what `building-view.ts` holds.
  - `frame(atMs, chained)`: feeds the library's `createWoodsGovernor` and the window; returns the share to apply when the governor just moved it, otherwise undefined.
  - `share()`: the current share.
  - `describe(inventedTrees, drawCost)`: the readout line.

## Invariants & assumptions

- The knobs are read-only boot overrides (`url-state.ts` header): read once in `main.ts`, never written back, no app control.
- Only a chained frame's interval enters the percentile, the same rule as the governor's: the first frame of a burst follows an idle pause.
- `frame` returns a share only on a change, so the view never re-applies an unchanged share (which would re-sort the trunk form's trees every drag frame).
- With `auto` false the share never moves, and the frame time and p95 are still measured, so a desktop readout shows numbers too.

## Examples

```ts
const knobs = readWoodsKnobs(
  location.search,
  matchMedia("(pointer: coarse)").matches,
);
const meter = createWoodsMeter(knobs.auto);
// in the frame callback, before the render:
const share = meter.frame(timestamp, chained);
if (share !== undefined) applyWoodsShare(group.children, share);
// after the render:
readout.textContent = meter.describe(inventedTrees, drawCost);
```

## Tests

`woods-readout.test.ts`: the knobs (coarse pointer, `woodsauto=off`, unknown tree forms, `perf=1` among other keys); the p95 over the last 10 s and invalid intervals; the readout line with and without measurements; the meter reporting one share change, never moving with auto off while still reading the frame time, and leaving an idle pause out. The e2e in `playwright-tests/scene-3d.spec.js` ("the woods governor's frame readout").
