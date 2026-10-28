# labs/globe/globe-perf-guard.js - the recorder's lost-context and frame guards

- Purpose: two things that end a sweep's measurement without throwing.
  A device that drops the page's graphics (a lost WebGL context: memory
  pressure on a phone) keeps the frames coming, because three.js keeps
  its animation loop, so a sweep that did not look would time an empty
  canvas. And frames that stop altogether while the page is on screen
  (a hung GPU process, a stalled page) would leave a sweep waiting
  forever with nothing to copy. The recorder (`globe-perf.js`) uses both
  to stop a sweep and keep what it measured.
- Public API:
  - `createContextWatch({ canvas, gl, now })` ->
    `{ setLabel(label), isLost(), report() }`:
    - listens to `canvas` for `webglcontextlost` and
      `webglcontextrestored` from construction on, whether a run is held
      or not;
    - `setLabel(label)` names where the sweep is; a loss is recorded with
      the label current at that moment;
    - `isLost()` is true from the first loss on, seen by the event or by
      `gl.isContextLost()` (a loss whose event was missed, `by: "check"`),
      and stays true after a restore: what was measured since the loss is
      not comparable;
    - `report()` -> `{ lost: { atMs, at, by } | null, restored: { atMs } |
null }`, copies. Only the first loss and the first restore after it
      are kept; a restore without a loss is ignored.
  - `createFrameWatchdog({ timeoutMs })` -> `{ frame(now), expired(now,
visible) }`:
    - `frame(now)` notes a frame;
    - `expired(now, visible)` is true when more than `timeoutMs` passed
      since the last frame while the page is visible. A hidden page, or
      no frame noted yet, resets the baseline: a browser stops the frames
      of a hidden page by design, and that is the `hidden` void's
      business, not a stall.
    - RangeError for a timeout that is not finite and > 0.
  - `FRAME_WATCHDOG_DEFAULT_S`: 60, the lab's `perfWatchdogS` default.
    Why a minute and not a few seconds: a healthy but slow device draws
    single frames of several seconds. An Intel iGPU at a pixel ratio of 2
    (the lab's cap, so a ratio-3 phone renders like it) drew single
    frames of 6.4 to 9.7 s in the items' warm-ups, and a 5 s default
    ended such a sweep as failed. A page whose frames really stopped is
    still ended, after a minute.
- Invariants & assumptions:
  - No DOM beyond `addEventListener` on the canvas; the clock is passed
    in, so both run under `node --test` with fakes.
  - Never throws after construction.
- Examples: `const context = createContextWatch({ canvas, gl:
renderer.getContext(), now: () => performance.now() });
context.setLabel("space n=5 r1"); if (context.isLost()) stop();`
- Tests: `globe-perf-guard.test.mjs` (a loss by the event with its
  label, a loss found by the check, the first loss kept, a restore only
  after a loss, the watchdog's expiry, its reset while hidden, the
  default letting a 10 s frame through, a bad timeout); `globe-perf-loss.smoke.spec.mjs` (a forced loss in the page
  stops the sweep and exports it).
