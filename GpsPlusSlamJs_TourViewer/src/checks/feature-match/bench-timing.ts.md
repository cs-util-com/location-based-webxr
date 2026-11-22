# bench-timing.ts

## Purpose

The speed test harness of the feature matching page: every arm loaded (download, checks, start-up), one first run each, then N rounds interleaved with a rotated order, so a phone that warms up or throttles slows every arm alike and a ratio to the reference arm stays meaningful. Also its plain-text report for the copy-log output.

## Public API

- Types `TimingStep` (named phases plus a sanity note), `LoadedTimingArm` (backend, downloads, start-up, notes, `step()`, `dispose()`), `TimingArm` (id, label, group, reference, `load()`), `ArmTiming`, `TimingHooks` (`now`, `yieldToUi`, `log`), `TimingReportInput`.
- `parseTimingRuns(text)`: a whole number 1 to 50, else 10.
- `timingBackends(ticked, webgpuAvailable)`: the ticked backends, WebGPU first; WebGPU without an adapter becomes WASM, with a note.
- `roundOrder(count, round)`: the arm indices rotated by `round`; `RangeError` for a count that is not a whole number.
- `runTiming(arms, { runs }, hooks)`: loads in order (a failed load is that arm's error), one first run per loaded arm, then `runs` rounds; a throwing run stops that arm with its error, the others go on. Every loaded arm is disposed, also when a hook throws.
- `referenceRatio(arm, all)`: the arm's steady median total over its group's healthy reference arm, else null.
- `methodTimingArm(method, input, { group, reference }, now)`: a bench method as an arm; a run is extract A, extract B and the match, its note counts keypoints, matches and (with a known warp) the correct ones within `CORRECT_TOL_PX`.
- `formatTimingReport(r)`: the report: start time, device, input, settings, the run scheme, then per arm backend, load and start-up, downloads, notes, first-run and steady (median / p90) times per phase and in total, the ratio, the last note and any error.

## Invariants and assumptions

- The first run is never in the steady statistics: it carries shader compilation and first-touch costs, reported on its own.
- Ratios are only taken within a group (the requested backend), so a WebGPU arm is never divided by a WASM reference.
- `loadMs` is what the harness saw (download + checks + start-up); `startupMs` is the session creation alone as the arm reports it.

## Example

```ts
const results = await runTiming(arms, { runs: 10 }, { now, yieldToUi, log });
report.value = formatTimingReport({
  startedAt,
  device,
  input,
  settings,
  runs: 10,
  results,
  errors,
});
```

## Tests

`bench-timing.test.ts`: round order (with a permutation property), the first run kept out and rounds interleaved, failed loads and runs, disposal when a hook throws, a property over healthy arms' run counts, ratios within a group only, the report's lines, and the runs and backend parsers.
