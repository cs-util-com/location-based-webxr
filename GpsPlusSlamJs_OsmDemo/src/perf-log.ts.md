# `perf-log.ts`

## Purpose

The `?perf=1` perf log for OsmDemo: a bounded record of the frames since load (chained frame intervals, bursts with their draw cost, woods share changes) and the plain-text report the "Copy perf log" button copies, so the woods governor (`gps-plus-slam-osm/three`'s `woods-governor.ts`) can be judged from a real phone by pasting text instead of sending screenshots. Pure: the view feeds the recorder and supplies the device, settings and readout; the report is built here and pinned in node without a GPU. The DOM half is `perf-log-panel.ts`.

## Public API

- The default limits (module-private): `{ intervals: 3000, bursts: 1000, shareChanges: 500 }`, how many entries each timeline keeps; `createPerfRecorder(limits)` takes others.
- `createRing(capacity)`: `push`, `items()` (oldest first, a copy), `dropped()`. Throws `RangeError` for a capacity that is not a positive integer.
- `createPerfRecorder(limits?, gapMs = WOODS_GOVERNOR.gapMs)`:
  - `frame(atMs, chained)`, called before the frame is drawn: a chained frame with a previous one records `[atMs, interval]`; an unchained frame (or the first) starts a burst. A non-finite time, or one not after the last accepted frame, is ignored whole, as the governor ignores it, so the next interval is measured from the same frame in both.
  - `drawn(cost)`, called after the frame's render with `renderer.info.render`'s draws and triangles: the first one after a burst start is that burst's `drawCost`.
  - `shareChange({ atMs, from, to, mode, averageMs })`: fed by `createWoodsMeter` (`woods-readout.ts`) with the governor's state just after the move.
  - `snapshot()`: the `PerfTimeline` (kept entries, dropped counts, the count and sum of every interval since load, the count of intervals over `gapMs`, and `gapMs`). The bursts are copies: later frames do not change a snapshot.
- A burst (`PerfBurst`): `{ atMs, drawCost, slowest }`. `slowest` is the burst's longest chained interval `{ atMs, ms, drawCost }`, where `drawCost` is the cost of the frame drawn just before it, the frame that interval measured; null while the burst has no chained frame. Draw costs are null until measured.
- `summarizeFrames(timeline)`: `{ frames, retained, rawMeanMs, longGaps, p50Ms, p95Ms, p99Ms, replayable }`.
  - The mean is RAW: every interval since load, lone gaps the governor leaves out (a tab coming back) included; `longGaps` counts the intervals over `gapMs` in it.
  - The percentiles read the kept intervals.
  - `replayable` is false once any ring dropped an entry: the timeline no longer starts at load, so a replay through the governor cannot match.
- `percentile(sortedAsc, q)`: the framework's nearest rank (`percentileOfSorted`, `gps-plus-slam-app-framework/utils/percentile`), undefined while empty.
- `pickQueryKnobs(search)`: `{ woodsauto, treeform, perf }` as raw strings or null, and nothing else of the query.
- `buildPerfReport(input)`: the report text. Sections, in order: a header with the privacy line, `== Summary ==` (with the raw mean and `replayable yes` or `no`), `== Readout ==`, `== Bursts ==` (the newest 10, each `at 16.1 s: start 109 draws / 1,760,000 tri · slowest 100.0 ms at 16.3 s after 109 draws / ...`), `== Device ==`, `== Settings ==`, `== JSON ==` followed by ONE line of JSON holding everything (format `osmdemo-perf-log/2`, summary, now, device, settings, timeline). Times are rounded to 0.1 ms; unknown values are `-` in the text and `null` in the JSON.
- `reportJson(report)`: parses that JSON line; throws when there is none.

## Invariants & assumptions

- Times are rAF timestamps, so ms from page start.
- The chained rule is the governor's: only a chained frame's interval is a frame time; an idle pause between two drags never reads as a slow frame.
- **Replayable by construction.** The recorder accepts exactly the frames the governor counts, and the JSON keeps `settings.governorOn` (the governor's `auto`), every burst start and every interval. Replaying them in time order through a fresh `createWoodsGovernor({ auto })` gives the logged share changes, mode and average included, while `replayable` is true; exact for times on the 0.1 ms grid, within the rounding otherwise.
- **The draw cost tells a zoom-out from a long frame.** A steady slow stretch with a high triangle count at its burst's start or slowest frame is the scene's cost; one long interval after a cheap frame is a hitch. Recording it costs one comparison per chained frame and one small object per burst.
- Every ring is bounded; the report always names how many entries were dropped, so a long session stays pasteable (about 3000 intervals is some tens of kB; 1000 bursts with two costs each add a similar amount).
- The JSON block is the last section and is one line (`JSON.stringify` escapes newlines), so free text elsewhere (a user agent, the readout, a query knob's value) cannot fake the marker; free text in the human lines is collapsed to one line, the knob values included.
- **Privacy.** The report contains no location, no camera position, no tile or cell ids, and no part of the URL other than the `woodsauto`, `treeform` and `perf` knobs. Nothing passed in carries a place: the inputs are times, counts, draw calls and triangles, the governor's state, the readout line (frame times, share, tree count, draw cost) and device facts. A property test puts a sentinel under another query key and asserts it never reaches the built report; the e2e checks that the boot's lat and lng do not appear.
- **Not store state.** The recorder is a bounded diagnostic buffer local to the 3D view, like the perf stats overlay: a cache of measurements nobody edits and no other view reads, one of the "what stays outside" cases of the Redux rule. It exists only with `?perf=1` (`BuildingView` creates it then and passes it to the meter), so with the knob off nothing is recorded at all.

## Examples

```ts
const recorder = createPerfRecorder();
const meter = createWoodsMeter(auto, recorder);
// per frame: meter.frame(timestamp, chained); render; recorder.drawn(cost);
const text = buildPerfReport({
  nowMs: performance.now(),
  device,
  settings,
  timeline: recorder.snapshot(),
  now,
});
```

## Tests

- `perf-log.test.ts`: the ring's order and dropped count; the recorder's chained and burst rules, invalid and non-increasing times, the draw cost at a burst's start and slowest frame, snapshots that later frames leave alone, the long-gap count, share changes, the bound and the all-time mean; nearest-rank percentiles (rounding up, not to the nearest rank); the knob picking; the report's sections, JSON and rounding, unmeasured values, every summary number pinned to its own value, `replayable` before and after a drop, the bursts in the JSON and the text, and a knob value with a newline kept on its line.
- `perf-log.property.test.ts`: a ring never exceeds its capacity and counts every push; recorded intervals stay bounded, positive and finite; percentiles are monotone and inside the range; the summary's percentiles are monotone for any frame sequence; a value under any other query key never reaches the report; replaying the report's frames through the governor gives its share changes (with a fixed example that steps down and back up); the JSON block always parses.
- The e2e in `playwright-tests/scene-3d.spec.js` ("perf=1 copies a perf log with every section and no location"): the copied text, read from the clipboard, carries every section, no location, format 2 and a burst with a measured draw cost.
