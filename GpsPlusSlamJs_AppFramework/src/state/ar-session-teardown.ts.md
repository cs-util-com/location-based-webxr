# ar-session-teardown.ts

## Purpose

The AR session-end STATE teardown every consumer app shares (DEC-H3
unification, 2026-08-26, when the third app grew the same sequence):
close the recording, drop the session's odometry↔GPS pairs and solved
alignment (zero PRESERVED), clear the coordinator's cached orientation.

## Public API

- `teardownArSessionState(store: ArTeardownStore): void` — dispatches
  `endSession()` + `resetGpsSessionData()` (core ≥ 1.20) and calls
  `resetCoordinatorState()`.
- `ArTeardownStore` — structural dispatch surface, so stores with extra
  reducers pass without widening.

## Invariants & assumptions

- The ZERO REFERENCE survives: scene content is placed in NUE metres
  relative to it, and resetting it would shift the geographic frame under
  content still on screen. Only per-session accumulations reset.
- Device-side teardown (camera capture, scene disposal, UI) stays with the
  caller — this is the STORE half only, safe for app-initiated and
  system-initiated (back gesture) ends alike.
- Callers: TourViewer (`endTourArRuntime`), MinimalExample
  (`onSessionEnd`), AnchorStarter (`failStart`).

## Examples

```ts
onSessionEnd: () => {
  stopCameraFrameCapture();
  teardownArSessionState(store);
};
```

## Tests

`ar-session-teardown.test.ts` — the full sequence against the real slices:
recording closed, pairs dropped, zero preserved.
