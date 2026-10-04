# labs/globe/globe-perf-recorder.js - the frame-hitch recorder's per-frame core

- Purpose: globe zoom frame-hitch plan 2026-10-03-2017 §4.1 (PERF-1). Turns
  the lab's frame starts and ends into frame intervals, joins the events
  marked in each frame to it, and keeps the count-only factors per run and
  the idle calibration's intervals. The whole-run statistics, the
  attribution join and the export are the framework's (PERF-0,
  `globe-perf-stats.js`), injected as `createRun`, so this file stays
  dependency-free and runs under `node --test`.
- Public API: `createPerfRecorder({ createRun })` returns:
  - `frameStart(nowMs)`: a frame begins and closes the one before. Its
    interval is from the previous start to this one (what the eye sees),
    and its events go to the run's `endFrame(interval, kinds)`.
  - `frameEnd(nowMs)`: the lab's own work for the frame is done; the rest
    of the interval is the gap (tile continuations, GC). Summed per run as
    `work.insideMs`.
  - `mark(kind, n = 1)`: an event in the current frame. RangeError for an
    empty kind or a count that is not a positive integer.
  - `sample(kind, value)`: a number taken in the current frame (the relief's
    node count, an E step's span).
  - `startRun(label)`: the run opens at the NEXT `frameStart`, so its first
    interval is whole.
  - `stopRun()` -> `{ label, summary, counts, samples, work }` or null:
    - `counts[kind] = { total, maxPerFrame, frames }`;
    - `samples[kind]` the values in order;
    - `work = { insideMs, frames }`.
  - `running()`, `startIdle()`, `stopIdle()` -> the idle intervals for
    `calibrateRefreshInterval`.
- Invariants & assumptions:
  - A frame's events are those marked between its start and the next
    start; the lab marks GPU objects created since the last start BEFORE
    calling `frameStart`, so they land in the frame that made them.
  - Events outside a run are dropped at the next start.
- Examples:
  ```js
  const rec = createPerfRecorder({ createRun: () => createFrameRun() });
  rec.startRun("alps r1");
  rec.frameStart(0);
  rec.mark("relief.load");
  rec.frameEnd(4);
  rec.frameStart(16.7);
  const { summary, counts } = rec.stopRun();
  ```
- Tests: `globe-perf-recorder.test.mjs` (intervals closed at the next start,
  events joined to their frame, the run opening at the next start, the
  counts and samples, the refusals, the idle intervals).
