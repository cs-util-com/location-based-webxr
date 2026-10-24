# rolling-window.ts

## Purpose

The mean and the worst of the samples of the last few seconds: the `?debug=1` readout's ms per radar draw and frame time, which the
field check reads against the 50 ms frame budget.

A time window, unlike the framework's `utils/frame-times` (the last N
frames as percentiles, which the mesh cursor's readout uses): "the last
2 s" means the same at 30 and at 60 frames a second, and the worst forgets
a slow frame once it is 2 s old. Promote it to the framework when a second
app needs it (DEC-H3).

## Public API

- `ROLLING_WINDOW_MS = 2000`.
- `createRollingWindow(windowMs = 2000, capacity = 1024) => RollingWindow`
  - `push(atMs, value)` - one sample; ignored for a non-finite time or a
    value that is not a finite number `>= 0`;
  - `summary(nowMs) => { mean, worst, count } | null` - the samples no
    older than the window (a sample exactly `windowMs` old is inside);
    null when none;
  - `reset()`.
  - Throws `RangeError` for a window that is no positive finite number or
    a capacity that is no positive integer.

## Invariants & assumptions

- Times are pushed in order (one clock, `performance.now()` in the page).
- At most `capacity` samples are held; the oldest go first, so a source
  faster than expected never grows it.
- No allocation per sample (two typed-array rings): it runs in the frame
  loop.

## Examples

```ts
const frames = createRollingWindow();
frames.push(performance.now(), dtMs);
frames.summary(performance.now()); // { mean, worst, count } | null
```

## Tests

- `rolling-window.test.ts` - the window's edge, the mean and worst, bad
  samples, the capacity, reset, the guards.
- `rolling-window.property.test.ts` - equals a naive filter over every
  sample at any rate and gap.
