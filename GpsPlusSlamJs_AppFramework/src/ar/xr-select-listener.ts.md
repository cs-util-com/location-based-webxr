# xr-select-listener.ts

## Purpose

Every WebXR `select` (a tap in AR the DOM overlay did not cancel) with
where it pointed, for an app that needs taps without a hit-test reticle:
the Tour Viewer's visitor tapping a pin to read its whole text (station
blocks plan B2b step 5). `targetRayOf` is shared with the reticle driver
(`hit-test-reticle-driver.ts`), which hears its own taps the same way.

## Public API

- `SelectTargetRay` - `{ targetRayInViewer: readonly number[] }`: the tap's
  target ray as a column-major 4x4 pose relative to the viewer (along -Z).
  Defined here; `hit-test-reticle-driver.ts` re-exports it.
- `startXrSelectListener(onSelect)` -> `XrSelectListener` (`dispose()`,
  idempotent). `onSelect(tap)` is called on every `select` of every AR
  session from now on, with `SelectTargetRay` (the input's target ray
  relative to the viewer) or null. A throw in `onSelect` propagates out of
  the event dispatch (the caller's).
- `targetRayOf(event, viewerSpace)` - the tap's target ray, or null when
  the viewer space, the event, its frame or the pose is missing, or the
  frame refuses (it is only active while the event is dispatched).

## Invariants & assumptions

- The session's `select` and `end` listeners are registered once per
  session, on the first XR frame of that session (`registerXrFrameUpdate`).
- The `viewer` space is requested once per session; a request that
  resolves after its session ended, or after `dispose()`, is dropped
  (a generation counter). A failed request leaves taps with a null ray.
- A tap before the viewer space is known, or one without a readable pose,
  is reported with null: the app treats it as the screen centre.
- No session feature is needed (unlike the reticle's `hit-test`).

## Examples

```ts
const taps = startXrSelectListener((tap) => {
  const id = pickObjectInView(targets, tap);
});
// On session teardown:
taps.dispose();
```

## Tests

- `xr-select-listener.test.ts` - one listener per session across frames,
  the ray once the viewer space resolved (null before it and for a bare
  event), a new session after an end heard while the ended session's late
  viewer space is dropped, `dispose()` removing listeners and the frame
  update, and every null case of `targetRayOf`. The frame loop is mocked.
- The reticle driver's own tests cover `targetRayOf` through its
  `onSelect`.
