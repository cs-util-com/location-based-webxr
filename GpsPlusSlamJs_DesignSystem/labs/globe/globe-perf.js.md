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
    - the thresholds counted: 33, 50 and 100 ms (the DEC-PERF-3
      verdict's), and after the calibration each run's `missedMs`
      (`missedThresholdsMs`: 1.5, 2.5 and 3.5 refresh intervals, the
      frames that missed at least 1, 2 and 3 refreshes);
    - the frame watchdog's 1 s look and the city gate's 10 s idle limit.
  - `createGlobePerf(lab)`. `lab` is the page's handle:
    - `renderer`, `canvas`, `globe`, `terrain` (null without the relief);
    - `params()` and `counts()`: the hash's values, and cheap counts with
      no raycast (so reading them never adds to what is counted);
    - `placeCamera(place, altitudeM)` and `updateControls()`;
    - `altitudeM()` and `wheelZoom(deltaY)` (a wheel event at the canvas
      centre, then the controls' update);
    - `settled()`, `setFactors(cell | null)`, `setEOverride(e | null)`,
      `currentE()`;
    - for the fixed-view sweep: `setItems(offsets, place)`,
      `placeView(view)`, `setPaused(paused)` (the frame renders nothing
      while true: the refresh calibration), `eyeMode` (the hash's `eye`)
      `viewReadiness()` (`{ band, release, city, osm }`, each true
      when ready), `cityDelivered()` (the city's deliveries drawn), and
      optionally `cityGate()`, `cityDrawn()`, `itemsInView()` and
      `osmCoverage()` (`globe-lab.js.md`).
  - It returns the hooks the lab's frame calls:
    - `frameStart(now)`, `frameEnd(now)`;
    - `drives()` and `drive(now)`: while a path runs, it owns the camera;
    - `mark(kind)`, `eStep(spanMs)`;
    - `api` for the smokes (`window.__globeLab.perf`): `run()`,
      `status()`, `runs()`, `exportText()`, `estimateMs()`,
      `refreshIntervalMs()`, `refresh()` (the snapped rate),
      `wakeLock()` (the screen lock's report), `contextLost()` and
      `forceContextLoss()` (drops the context as a device would, through
      `WEBGL_lose_context`: the smoke's and a desktop check's way to
      prove a sweep stops and keeps its results). `run()` starts a sweep
      as the Run button does.
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
  - A touch anywhere but on the recorder's panel (a document listener
    in the capture phase), the page leaving the screen, a resize or a
    turn of the phone and a lost WebGL context void the run in progress
    (marked `VOID`); the run's `voidedBy` lists the kinds in order.
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
  - `touch`, `hidden`, `resize` (a turn of the phone changes the
    viewport, so it fires `resize`; the deprecated `orientationchange`
    is not listened to), `context.lost`, `context.restored` (the run is
    void).
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
- The fixed-view sweep (`perfItems=0,5,20,50`, `globe-perf-views.js`):
  - The screen: a Screen Wake Lock is held from the start to Done
    (`globe-perf-wake.js`), asked for again at once when the browser
    releases it while the page is visible and when the page comes back;
    its request is raced against 3 s, so a request that never settles
    does not hold the sweep. While it is refused, missing or lost, the
    status line asks the tester to set the screen's auto-lock to Never. The export's `wakeLock` says whether
    it held throughout. A run the hidden page interrupted is void.
  - The calibration: the frame renders nothing (`lab.setPaused(true)`)
    for 2 s, so the median frame interval is the display's own, snapped
    to 30, 60, 90 or 120 Hz (`snapRefreshInterval`); a measurement more
    than 10 % off its rate is flagged (`refresh.mismatch`, and the
    device block's `refreshMismatch`). The drop counts use the snapped
    interval.
  - The plan (`perfViewCells`): a discarded warm-up pass per view
    (`perfWarmup=1`, the default) and then each repeat with the counts'
    order rotated per repeat and view, reversed on even repeats. Without `eye=1` the street view is
    left out (`viewsSkipped`, and said in the plan) rather than measured
    from a camera the editor never uses. The estimate includes the
    calibration and is labelled as an estimate; the plan line adds "plus
    up to N min waiting for the city" (`perfCityWaitS`, which the
    estimate leaves out; `perfViewsPlanText`); the status shows "Cell k
    of N" and the estimate's minutes left, counted from after the city
    wait, or that it is past. The quiet waits are not in the estimate.
  - The city gate: before the calibration, at most `perfCityWaitS`
    (default 300) for the city's load to end, its retries included
    (`lab.cityGate()`); a city not asked for within 10 s is not waited
    for. The export's `cityGate` is `{ outcome, ms }` (`off`, `ended`,
    `gave-up`, `not-requested`, `timeout` or `skipped`).
  - Per move: the camera placed every frame (`lab.placeView`, so the
    street view follows the ground as it refines), then a settle of at
    most `perfViewSettleS`: the drawn carriers idle AND every
    `lab.viewReadiness()` key true: the band's drawn share at the
    altitude's (an undrawn relief reads as idle), no band cache release
    pending or draining, the city not loading and its arrival fade done
    (a delivery inside a held run voids it), the OSM map's ramp done with
    no re-evaluation backlog and no drawn tile waiting but the failed
    ones (never asked for again).
  - The city comes from public Overpass servers and may not come at all
    (measured 2026-10-27 on this desktop: no reply in 3 min). When a
    move's settle times out on the city and it has delivered nothing, the
    sweep stops waiting for it (`cityGaveUp`, the move's label, in the
    export and the overlay) and measures without it; once it delivers it
    is waited for again, and a held run it lands in is void
    (`city.arrived`).
  - Per count: the items set (`lab.setItems(itemOffsets(n), place)`) and
    their first 500 ms recorded as their own sample (`itemsWarm`: frames,
    the worst frame, the programs, textures and geometries made), then a
    quiet wait of at most `perfQuietS` for the same readiness (a release
    starts 5 s after a carrier leaves the band, so it can fall inside a
    held run), then a run held `perfHoldS` and at least 3 more frames
    (`GLOBE_PERF.viewMinFrames`), labelled `<view> n=<count> r<repeat>`,
    with the bytes the page had needed (`bytesDownloaded`,
    `/globe-assets/` only), the bytes at the move (`bytesAtMove`) and the
    settle's outcome (`settle: { move, moveMs, moveNotReady, quiet,
quietMs, notReady, osm }`, `osm` the map's tiles waiting and failed),
    the viewport (`viewport`, width x height @ DPR), the items inside the
    camera's frustum right before it (`itemsInView`) and whether the
    city drew (`cityDrawn`).
    What decides is the view right before the run: a run whose quiet wait
    timed out is kept but marked (`settledBefore: false`) and the table
    counts it and leaves it out of every number; a slow move whose view
    was ready by the run is pooled.
  - The overlay shows the pooled table (`formatViewTable`: p50, p95, max,
    work per frame, drop, and the frames that missed at least 1, 2 and 3
    refreshes, against the measured rate, and the MiB each move needed)
    and whether the screen stayed on; the export adds `views`
    (`summariseViewRuns`), `viewDownloads`, `viewsSkipped`,
    `cityGaveUp`, `cityGate`, `refresh`, `missedMs` and `wakeLock`,
    and the file name says `views`.
  - How a sweep ends: Done, stopped or failed, the summary of the runs
    finished and Copy and Download enabled every time (`outcome`,
    `failure: { message, at }`), and the status ends "Copy or Download
    the result." A failed or stopped sweep removes its items and unpauses
    the frame. After a lost context Run stays disabled and the status
    ends "Copy or Download them, then reload the page.": the context
    stays lost, so a new sweep would wipe the kept results and stop at
    once.
  - A lost context (`globe-perf-guard.js`), noticed whenever it happens
    and checked before every run, stops the sweep at once: "The device
    dropped the page's graphics at <where>; results up to there are
    kept." The export's `contextLost` (`{ atMs, at, by }`) and
    `contextRestored` say when and where. The device block is read at
    load and once after the calibration, so it names the GPU even after
    a loss.
  - The frame watchdog: no frame for `perfWatchdogS` (default 60,
    `FRAME_WATCHDOG_DEFAULT_S`) while the page is on screen fails the
    sweep with where it was. A minute, because a healthy but slow device
    draws single frames of several seconds (an Intel iGPU at a pixel
    ratio of 2, as a ratio-3 phone renders under the lab's cap: 6.4 to
    9.7 s in the items' warm-ups), and the sweep runs once on the phone.
  - A reload (`globe-perf-journal.js`): the export is kept in the
    browser's storage after every run and at the end, with the link
    (`location.hash`). A page that finds this link's sweep there,
    whatever its state (a reload after Done included), does not start by
    itself, even with `perfAuto=1`: it shows "Previous sweep cut off
    after N of M runs (page reloaded)" (or "finished: N of M runs",
    stopped or failed; `previousSweepText`), Copy and Download give that
    sweep's export (the file name says `cut-off`, or `previous` for a
    sweep that ended), and Run reads "Start fresh". A sweep kept from
    other settings is offered the same way ("An earlier sweep with other
    settings is kept ...") but does not block `perfAuto=1`, and the new
    sweep replaces it. The export's `journal` reports the saves.
  - `perfAuto=1` starts any sweep without a press.
- The export: the framework's `frame-export/1` (`buildFrameExport`: the
  device block, every run, the pooled attribution, the 20 worst frames
  with their events), plus `lab` (per run: index, time since load, cell,
  hooks, void, counts, samples, work, peaks, checkpoints, the E check),
  `overhead` (`perfOverheadVerdict`) and `longAnimationFrameMs`. The
  device block (read at load and after the calibration): user agent,
  GPU strings where exposed, DPR, viewport,
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
  raycasts. `globe-perf-views.smoke.spec.mjs` (the fixed-view sweep and
  its per-run records); `globe-perf-loss.smoke.spec.mjs` (a reload
  mid-sweep offers the cut-off sweep and does not start by itself; a
  forced context loss stops the sweep with Copy and Download enabled, Run
  disabled, the loss's place and the GPU's name in the export).
