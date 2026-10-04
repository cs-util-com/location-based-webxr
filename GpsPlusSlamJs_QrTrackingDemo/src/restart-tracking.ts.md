# restart-tracking.ts

## Purpose

The QR demo's restart wiring (QR near-frontal pose plan 2026-09-23-2314,
M3b b5): builds the session's `tracking` callbacks group so the demo hears
about odometry restarts, and turns each into a QR frame change
(`qrFrameChanged`), so the fused window never combines two coordinate
frames.

## Public API

- `createRestartTracking(onFrameChanged): { store, onRestarted }` - pass it
  as `initAR`'s `callbacks.tracking`. `store` is a store of its OWN (built
  with the framework's `createSlamAppStore`, holding the tracking slice);
  `onRestarted` calls `onFrameChanged`.

## Invariants & assumptions

- A SEPARATE store on purpose: the session dispatches every frame's pose
  into it, and the demo's own store re-renders the HUD on every change.
- Only `onRestarted` is used; `onLost` / `onRecovered` are not needed by the
  demo (a recovery without an origin reset keeps the frame).
- The session moves its subscription with the store it was given; the demo
  never rebinds.

## Examples

```ts
await initAR(
  container,
  isolation,
  {},
  {
    tracking: createRestartTracking(() => store.dispatch(qrFrameChanged())),
  },
);
```

## Tests

`restart-tracking.test.ts`: a restart is reported as a frame change; each
call builds its own store, which holds the tracking slice.
