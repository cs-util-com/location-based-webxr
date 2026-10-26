# long-press.ts

## Purpose

A finger's long press timed by the page. iOS sends no `contextmenu` for a
long press, so without it the 3D view's ground menu ("New station here")
could not open on an iPhone or an iPad. `editor3d-input.ts` uses it for
every touch on the scene.

## Public API

- `LONG_PRESS` - `{ holdMs: 500, tolerancePx: 8 }`: about half a second,
  and the tap's tolerance (`INPUT.tapPx`).
- `createLongPress({ holdMs, tolerancePx, schedule, cancel, fire })` ->
  `LongPress`:
  - `down(pointerId, at)` - a finger went down: the first starts the
    hold; a second (a pinch) stops it.
  - `move(pointerId, at)` - past `tolerancePx` from where the finger went
    down, the hold stops for that press (moving back does not restart it).
  - `end(pointerId)` - a finger went up or was cancelled.
  - `cancel()` - stop the hold under way (a gizmo drag took the press).
  - `fire(at)` is called once, with the point the finger went down at,
    when the hold runs out.

## Invariants & assumptions

- At most one hold at a time; it fires at most once per press.
- `schedule` / `cancel` are the timer (the window's `setTimeout` in the
  page; a hand-driven clock in the tests).
- A non-finite or non-positive `holdMs`, or a non-finite or negative
  `tolerancePx`, falls back to `LONG_PRESS`'s.
- Every finger that was passed to `down` must reach `end`: the count of
  fingers down decides whether a new press is a second finger.
- What the long press opens, and whether the press may still open it (no
  drag, not moved), is the caller's check in `fire`.

## Examples

```ts
const press = createLongPress({
  ...LONG_PRESS,
  schedule: (run, ms) => window.setTimeout(run, ms),
  cancel: (id) => window.clearTimeout(id),
  fire: (at) => openMenuAt(at),
});
press.down(event.pointerId, at);
```

## Tests

`long-press.test.ts`: swept over holds of 400, 500 and 700 ms and
tolerances of 4, 8 and 12 px - it fires once after the hold for a finger
within the tolerance, never for one that moved past it (even back
again), never for a second finger or an early release; other pointers'
moves and ends are ignored; `cancel` stops it; the defaults.
`editor3d-input.test.ts` drives it through the scene's input.
