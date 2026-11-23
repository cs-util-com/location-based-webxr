# bench-engine.ts

## Purpose

The measuring block of the feature matching page, shared by its views: the Options and Speed test controls, the benchmark runs, the results table, the result pictures, the report, Copy log and the log. The page-wide rules it implements are listed in `feature-match-check.ts.md` (Results, Options check, Photo test settings, Speed test, Copy log).

## Public API

- `CAPTURE_MAX` (1280): the longest side a captured camera frame is kept at.
- `$(root, selector)`: the element, or throws `feature-match-check: missing <selector>`.
- `startBenchEngine({ root, fm, log, fail, stamp, stopCamera })` returns `{ startRun(kind), render(), deviceInfo() }`.
  - `startRun("synthetic" | "plan")`: reads the controls once more, then runs only when the reducer accepted `runStarted(kind)`; every path ends in `runFinished`.
  - `render()`: buttons, labels, status lines, and the table, report and log only when their part of the state changed.
  - `deviceInfo()`: device facts, or `UNKNOWN_DEVICE` with a log line.

## Invariants and assumptions

- The pair a run measures: the synthetic pair (seed 1, known warp), or the plan's current pair (`planPairOf`, settings from the slot's protocol key; without both photos of it, "take photo A and B of this pair first"). A missing frame is an `ERROR input:` line and "not run: no input".
- A plan run keeps its results in `sides.results` under a fresh id named by `runFinished`, in the same step (`put`); other runs keep none.
- The speed test uses the plan's complete current pair, else the pair the last plan run measured while that take is unchanged (`speedPairOf`), else the synthetic pair. Both views share the plan, and it and its photos are restored at every load, so either view times the pair the other one took.
- `stopCamera` is called before anything is timed; the speed test holds `guardRun` (wake lock, hidden-page report line).
- WebGPU counts only when `requestAdapter()` gives an adapter, asked once per page.

## Example

```ts
const engine = startBenchEngine({
  root: document,
  fm,
  log,
  fail,
  stamp,
  stopCamera: camera.stop,
});
store.subscribe(engine.render);
engine.startRun("plan");
```

## Tests

Browser-only DOM code: covered by `playwright-tests/feature-match-check.spec.js` (synthetic and plan runs, the speed test, Copy log). The rules it calls are unit-tested in `bench-run`, `bench-methods`, `bench-timing`, `speed-test` and `guided-model` (`planPairOf`).
