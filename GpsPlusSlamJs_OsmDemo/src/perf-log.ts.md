# `perf-log.ts`

## Purpose

The `?perf=1` perf log for OsmDemo: a bounded record of the frames since load (chained frame intervals, unchained burst starts, woods share changes) and the plain-text report the "Copy perf log" button copies, so the woods governor (`gps-plus-slam-osm/three`'s `woods-governor.ts`) can be judged from a real phone by pasting text instead of sending screenshots. Pure: the view feeds the recorder and supplies the device, settings and readout; the report is built here and pinned in node without a GPU. The DOM half is `perf-log-panel.ts`.

## Public API

- `PERF_LOG_LIMITS`: `{ intervals: 3000, bursts: 1000, shareChanges: 500 }`, how many entries each timeline keeps.
- `createRing(capacity)`: `push`, `items()` (oldest first, a copy), `dropped()`. Throws `RangeError` for a capacity that is not a positive integer.
- `createPerfRecorder(limits?)`:
  - `frame(atMs, chained)`: a chained frame with a previous one records `[atMs, interval]`; an unchained frame (or the first) records a burst start. Non-finite times and intervals that are not positive are ignored.
  - `shareChange({ atMs, from, to, mode, averageMs })`: fed by `createWoodsMeter` (`woods-readout.ts`) with the governor's state just after the move.
  - `snapshot()`: the `PerfTimeline` (kept entries, dropped counts, the count and sum of every interval since load).
- `summarizeFrames(timeline)`: `{ frames, retained, meanMs, p50Ms, p95Ms, p99Ms }`. The mean counts every interval since load; the percentiles read the kept ones.
- `percentile(sortedAsc, q)`: nearest rank, undefined while empty.
- `pickQueryKnobs(search)`: `{ woodsauto, treeform, perf }` as raw strings or null, and nothing else of the query.
- `buildPerfReport(input)`: the report text. Sections, in order: a header with the privacy line, `== Summary ==`, `== Readout ==`, `== Device ==`, `== Settings ==`, `== JSON ==` followed by ONE line of JSON holding everything (format `osmdemo-perf-log/1`, summary, now, device, settings, timeline). Times are rounded to 0.1 ms; unknown values are `-` in the text and `null` in the JSON.
- `reportJson(report)`: parses that JSON line; throws when there is none.

## Invariants & assumptions

- Times are rAF timestamps, so ms from page start.
- The chained rule is the governor's: only a chained frame's interval is a frame time; an idle pause between two drags never reads as a slow frame.
- Every ring is bounded; the report always names how many entries were dropped, so a long session stays pasteable (about 3000 intervals is some tens of kB).
- The JSON block is the last section and is one line (`JSON.stringify` escapes newlines), so free text elsewhere (a user agent, the readout) cannot fake the marker; free text in the human lines is collapsed to one line.
- **Privacy.** The report contains no location, no camera position, no tile or cell ids, and no part of the URL other than the `woodsauto`, `treeform` and `perf` knobs. Nothing passed in carries a place: the inputs are times, counts, the governor's state, the readout line (frame times, share, tree count, draw cost) and device facts. A property test holds `pickQueryKnobs` to its three keys for any query; the e2e checks that the boot's lat and lng do not appear.
- **Not store state.** The recorder is a bounded diagnostic buffer local to the 3D view, like the perf stats overlay: a cache of measurements nobody edits and no other view reads, one of the "what stays outside" cases of the Redux rule. It exists only with `?perf=1` (`BuildingView` creates it then and passes it to the meter), so with the knob off nothing is recorded at all.

## Examples

```ts
const recorder = createPerfRecorder();
const meter = createWoodsMeter(auto, recorder);
// per frame: meter.frame(timestamp, chained);
const text = buildPerfReport({
  nowMs: performance.now(),
  device,
  settings,
  timeline: recorder.snapshot(),
  now,
});
```

## Tests

- `perf-log.test.ts`: the ring's order and dropped count; the recorder's chained and burst rules, invalid times, share changes, the bound and the all-time mean; nearest-rank percentiles; the knob picking; the report's sections, JSON and rounding, unmeasured values.
- `perf-log.property.test.ts`: a ring never exceeds its capacity and counts every push; recorded intervals stay bounded, positive and finite; percentiles are monotone and inside the range; the summary's percentiles are monotone for any frame sequence; the picked knobs never carry another key; the JSON block always parses.
- The e2e in `playwright-tests/scene-3d.spec.js` ("perf=1 copies a perf log with every section and no location").
