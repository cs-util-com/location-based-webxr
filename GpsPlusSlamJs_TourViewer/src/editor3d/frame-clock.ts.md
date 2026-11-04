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
    - `meanMs()`, `worstMs()`: of the intervals kept; 0 before the second
      frame.
    - `slowFrames()`: the frames over `SLOW_FRAME_MS` within
      `SLOW_WINDOW_MS` of the last tick.
    - `recentMs()`: the intervals kept, oldest first, as a copy (the
      globe's stats list them).
- Invariants & assumptions:
  - Bounded memory: at most `keep` intervals, and slow frames only from
    the last five seconds (pruned on each tick).
  - A frame of exactly 50 ms is not slow.
  - The window is measured from the last tick, not the wall clock: a view
    that stops drawing keeps its last count until it draws again. A long
    gap (a hidden tab) is itself one slow frame.
- Example:
  ```ts
  const clock = createFrameClock();
  renderer.setAnimationLoop((now) => {
    clock.tick(now);
  });
  clock.meanMs(); // the readout's frame time
  ```
- Tests: `frame-clock.test.ts` (the empty clock, mean and worst, the
  bound, the five-second window, the 50 ms edge, a property over random
  frame gaps).
