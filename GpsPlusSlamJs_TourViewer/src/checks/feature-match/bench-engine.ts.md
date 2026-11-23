# bench-engine.ts

## Purpose

The measuring block of the feature matching page, shared by its views: the Options and Speed test controls, the benchmark runs, the results table, the result pictures, the report, Copy log and the log. The page-wide rules it implements are listed in `feature-match-check.ts.md` (Results, Options check, Photo test settings, Speed test, Copy log).

## Public API

- `CAPTURE_MAX` (1280): the longest side a captured camera frame is kept at.
- `$(root, selector)`: the element, or throws `feature-match-check: missing <selector>`.
- `startBenchEngine({ root, fm, log, fail, stamp, stopCamera })` wires the Run synthetic, Speed test and Copy log buttons and returns `{ render(), deviceInfo() }`.
  - The synthetic run and the speed test run only when the reducer accepted `runStarted(kind)`; every path ends in `runFinished`.
  - `render()`: buttons, labels, status lines, and the table, report and log only when their part of the state changed.
  - `deviceInfo()`: device facts, or `UNKNOWN_DEVICE` with a log line.

## Invariants and assumptions

- The synthetic run measures the synthetic pair (seed 1, known warp). Nothing is measured on the run's photos on the phone in this version: the photos go to the PC in the run zip.
- The speed test times the flat scene's F1 and F2 (`SPEED_SHOTS`, the flat control pair `2a`) when both are taken and loaded, else the synthetic pair. Both views share the plan, and it and its photos are restored at every load, so either view times the photos the other one took.
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
```

## Tests

Browser-only DOM code: covered by `playwright-tests/feature-match-check.spec.js` (the synthetic run, the speed test, Copy log). The rules it calls are unit-tested in `bench-run`, `bench-methods`, `bench-timing` and `speed-test`.
