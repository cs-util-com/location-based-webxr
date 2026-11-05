# frame-clock.ts

- Purpose: the 3D views' frame clock. Both views (`editor3d-scene.ts`,
  `editor3d-globe.ts`) tick one per drawn frame; their `readout()` gives
  its mean, its worst interval and its slow-frame count to the editor
  shell, whose Performance tab and its badge show them.
- Public API:
  - `SLOW_FRAME_MS` (50): an interval over this is a slow frame.
  - (module-private) `SLOW_WINDOW_MS` (5,000): how long a slow frame is
    counted.
  - `createFrameClock(keep = 60)`: a `FrameClock` keeping the last `keep`
    intervals.
    - `tick(now)`: a frame drawn at `now` (ms).
    - `pause()`: the frames stopped (a hidden page, a canvas without a
      size); the gap up to the next tick is not timed.
    - `meanMs()`, `worstMs()`: of the intervals kept; 0 before the second
      frame.
    - `slowFrames()`: the frames over `SLOW_FRAME_MS` within
      `SLOW_WINDOW_MS` of the last tick.
    - `recentMs()`: the intervals kept, oldest first, as a copy (the
      globe's stats list them).
  - `pauseWhenHidden(clock, page = document)`: pauses `clock` on each
    `visibilitychange` to hidden and on each `framesstopped` (the
    browser's own question answered, `../editor/browser-question.ts`);
    returns the function that stops listening (a view pushes it on its
    undo list).
- Invariants & assumptions:
  - Bounded memory: at most `keep` intervals, and slow frames only from
    the last five seconds (pruned on each tick).
  - A frame of exactly 50 ms is not slow.
  - The window is measured from the last tick, not the wall clock: a view
    that stops drawing keeps its last count until it draws again. A pause
    is a signal, never a gap length: the views call `pause()` when they
    skip a frame for a canvas without a size (the globe view) and on a
    hidden page (`pauseWhenHidden`, both views), so a real hitch of any
    length (a shader compile, a tile burst) is still timed and counted.
- Example:
  ```ts
  const clock = createFrameClock();
  renderer.setAnimationLoop((now) => {
    clock.tick(now);
  });
  clock.meanMs(); // the readout's frame time
  ```
- Tests: `frame-clock.test.ts` (the empty clock, mean and worst, the
  bound, the five-second window, the 50 ms edge, the gap after a pause untimed, a long frame without a
  pause counted, hiding pausing and the listener removed, a property over random
  frame gaps, the wait for the browser's question untimed).
