# labs/globe/globe-perf.js - the globe lab's frame-hitch recorder

- Purpose: globe zoom frame-hitch plan 2026-10-03-2017 §4 (PERF-1). Measures
  the frame hitches of a zoom through the altitude band on the device that
  sees them (a real phone, DEC-PERF-1) and counts their candidate
  causes (H1-H8) under SwiftShader. `globe-lab.js` loads it with a dynamic
  import only with `#perf=1`; without the flag the page fetches nothing of
  it and does no recorder work.
- Public API:
  - `GLOBE_PERF`: the recorder's constants:
    - 2 s idle calibration;
    - 10 settled frames for a settle;
    - 30 s at most to settle after a move;
    - the full sweep's 60 s pause;
    - the held E change of 0.1;
    - at most 200 long-animation-frame durations kept;
    - the thresholds counted: 33, 34, 50, 51 and 100 ms. At 60 and
      120 Hz, 33.3 and 50 ms are whole refresh multiples, so one missed
      vsync already counts as over 33; the export carries both readings
      and the DEC-PERF-3 verdict keeps the plan's (33 and 50).
  - `createGlobePerf(lab)`. `lab` is the page's handle:
    - `renderer`, `canvas`, `globe`, `terrain` (null without the relief);
    - `params()` and `counts()`: the hash's values, and cheap counts with
      no raycast (so reading them never adds to what is counted);
    - `placeCamera(place, altitudeM)` and `updateControls()`;
    - `altitudeM()` and `wheelZoom(deltaY)` (a wheel event at the canvas
      centre, then the controls' update);
    - `settled()`, `setFactors(cell | null)`, `setEOverride(e | null)`,
      `currentE()`.
  - It returns the hooks the lab's frame calls:
    - `frameStart(now)`, `frameEnd(now)`;
    - `drives()` and `drive(now)`: while a path runs, it owns the camera;
    - `mark(kind)`, `eStep(spanMs)`;
    - `api` for the smokes (`window.__globeLab.perf`): `run()`,
      `status()`, `runs()`, `exportText()`, `estimateMs()`,
      `refreshIntervalMs()`.
- The overlay (§4.1): the plan (sweep, runs, estimated minutes) before
  Run, the remaining minutes while it runs, then the framework's summary
  per run (p50/p95/p99/max, the counts over each threshold, PASS or
  FAIL against DEC-PERF-3 with the handfuls 3, 5 and 10, the three
  strongest causes), how many runs met the target, and the recorder's own
  cost when the overhead sweep ran. Run, Copy and Download are 48 px tall.
  Copy and Download go through `globe-perf-share.js`; both fall back to a
  selected text box.
- The paths (§4.2), at the places of `/globe/globe-perf-path.js`:
  - Time-driven (default): 20,000 km down to 30 km and back at the cell's
    speed in decades a second, with the flight's pitch law
    (`pitchAtDeg`), placed as the dive places the camera
    (`obliqueCamera`). Each frame the controls' own update then runs, so
    their height-adjustment raycasts (two a frame, H5) are counted as in a
    real zoom. The plan drives the controls' zoom input; placing the
    camera keeps runs comparable, so it is the default.
  - Driven through the controls (a cell's `drive: "controls"`, one Alps
    cell of `quick`, or `perfDrive=controls` for every run): each frame
    a wheel event at the canvas centre whose `deltaY` closes on the same
    law's altitude (`perfWheelDeltaY`), then the controls' update, so
    their zoom-point raycast (H5, what a pinch or a wheel costs) is
    counted as well. The view follows the controls, not the pitch law; a
    wheel, not a two-finger pinch, though both reach the same zoom code.
  - Frame-stepped (`perfStep=1`): one fixed step in the logarithm of the
    altitude per frame (`perfSteps` a decade), whatever the frame takes;
    the six settle checkpoints hold until the drawn carriers' queues are
    empty or `perfSettleS` passes, and record counts; at 1,000 km on the
    way down E is raised by 0.1 with the camera held (H1's load wave) and
    restored. Counts only. Each checkpoint records the path's altitude and
    the camera's own above the ellipsoid (below 90 degrees of pitch the
    camera stands back over ground of another radius: about 4 km lower at
    the Alps in the band). Always placed, never through the controls.
  - A touch on the canvas, the page leaving the screen and a lost WebGL
    context void the run in progress (marked `VOID`).
- The events per frame (§4.1), as kinds:
  - `globe.load`, `globe.dispose`, `relief.load`, `relief.dispose`;
  - `program.new`, `texture.new`, `geometry.new` (the renderer's deltas
    since the last frame start, marked in the frame they were made in);
  - `e.step` with the assignment's span as the sample `e.step.ms`, then
    `nodes.walk` on the next frame with the sample `relief.nodes` (the
    preprocessed nodes, `traverse` without processing);
  - `band.edge` (the share leaves or reaches 0 or 1), `band.mixed` (a
    frame inside the cross-fade), `release.globe`, `release.relief`;
  - `raycast` (the relief plugin's `raycastTile`, wrapped);
  - `loaf` (long animation frames, Chrome only, 50 ms and more);
  - `touch`, `hidden`, `context.lost`, `context.restored` (the run is void).
  - Per run also: the peaks of each carrier's cache (MiB), the globe's
    pending tiles and the lowest altitude reached (km).
- The sweep (§4.4): `perfSweep=quick|full|overhead` runs the cells of
  `/globe/globe-perf-sweep.js` in one load after a 2 s idle calibration at
  the first place's top; without it, one run at `perfPlace` (default the
  Alps). Each cell sets its factors through `lab.setFactors`
  (`adjustHeight`, the relief's cache cap and queues, the pixel-ratio cap);
  the hash's values come back at the end. `perfSpeed` replaces every
  cell's speed (short runs for the smokes). The overhead sweep turns the
  hooks off (frame intervals only) on alternate runs.
- The export: the framework's `frame-export/1` (`buildFrameExport`: the
  device block, every run, the pooled attribution, the 20 worst frames
  with their events), plus `lab` (per run: index, time since load, cell,
  hooks, void, counts, samples, work, peaks, checkpoints, the E check),
  `overhead` (`perfOverheadVerdict`) and `longAnimationFrameMs`. The
  device block: user agent, GPU strings where exposed, DPR, viewport,
  drawing buffer, relief, host and path (a preview's host names its
  branch or commit), the hash, `KHR_parallel_shader_compile`,
  `OES_texture_float_linear`, `EXT_disjoint_timer_query_webgl2` (logged
  only: the GPU pass times are not read), long-animation-frame support,
  `deviceMemory`, `hardwareConcurrency`, the calibrated refresh interval,
  and every hash value as `flag.<name>`.
- Invariants & assumptions:
  - Never calibrates inside the band: the calibration holds the camera at
    20,000 km.
  - The settle waits for the DRAWN carriers only; at oblique views inside
    the band the globe's queue may not drain, so a checkpoint records
    `settled: false` at its timeout rather than waiting forever.
  - The recorder's reads at checkpoints use `counts()`, never the page's
    `state()` (which raycasts the centre and would count itself).
- Examples: `#relief=1&perf=1&perfSweep=quick` (the phone run);
  `#relief=1&reliefHeights=synthetic&perf=1&perfStep=1&perfSteps=8&perfSettleS=20`
  (a short counted path).
- Tests: `globe-perf.smoke.spec.mjs`: no recorder without the flag; the
  frame-stepped path's events, checkpoints and E check; the overlay and
  Copy/Download at 390 x 844 DPR 2; the overhead sweep's hooks off and on;
  a run driven through the controls reaching the bottom and counting their
  raycasts.
