# `ar-mode.ts`

## Purpose

Starts a WebXR session, hands the already-built city to the framework's scene
graph in the right frame, subscribes the world group to the fusion's alignment,
and gives the city back on the way out.

## Scope — AR milestones 1 to 5

**In:** the session lifecycle, the attachment, the alignment subscription, the
scene environment and camera planes, the measurement sampler, and teardown of
all of it on both the app-initiated and system-initiated exits.

**Out:** nothing, now that milestones 3 to 5 have landed. This file starts the
session and owns what the session owns: the attachment, the alignment, the
environment, the measurement sampler, and teardown of all of it on both exits.
The distance gate lives in [`ar-walk-controller.ts`](ar-walk-controller.ts.md),
the readout in [`ar-hud.ts`](ar-hud.ts.md), and the desktop renderer's suspend/
resume in `building-view.ts` — each called from here or from `main.ts`.

**M2 lives in [`ar-scene-environment.ts`](ar-scene-environment.ts.md), not
here**, and is only _called_ from here. This demo has a recorded history of a
wrong scene environment making every `MeshStandardMaterial` **fail to compile
and silently not draw for ten work items while every assertion stayed green**,
so the rule against setting one is stated and tested in a module a reader can
point at, rather than being an absence in this file that nobody notices. The
camera planes moved there with it: fog has to end exactly at the far plane, so
the two are one decision.

## Public API

- `ArModeDeps` — `{ container, store, buildingView, origin, sceneAnchor, enuFrameAt, onError, onEnded? }`.
  - `store` is the INTERSECTION `TrackingSubscribableStore & SubscribableStore`, because `initAR` and the alignment wiring want different `getState` shapes and neither subsumes the other. Stated as an intersection rather than as the concrete `SlamAppStore`, whose shape changes with the demo's `extraReducers`.
  - `sceneAnchor` and `enuFrameAt` are how the city's own ENU origin is reconciled with the GPS one. The mesh is authored about the demo's anchor and the GPS-world frame is about `zero`; without the offset the city renders at the right orientation and the wrong place.
  - `origin` is the framework's `zero`, read by the caller. `null` means no fix.
- `startArMode(deps): Promise<ArMode>` — **never rejects.** A refused session,
  an unsupported device and a missing GPS fix are ordinary outcomes the page
  renders, not exceptions; all of them reach the user through `onError` and
  return an inert handle.
- `ArMode` — `{ started, dispose() }`, idempotent. **Drive UI from `started`,
  not from "a handle came back":** a handle always comes back, an inert one on a
  refused permission. Treating that as a live session showed the user an error
  toast and an "Exit AR" button at the same time.

## Invariants & assumptions

- **Entry is gated on a first GPS fix, BEFORE `initAR`.** The origin is the
  framework's `zero`, `null` until a fix lands, and DEC-R11-6 rejected
  re-anchoring on the first non-null `zero` — so entering early and correcting
  later is not available. Checking before `initAR` also avoids prompting for
  camera permission and then refusing to draw anything.
- **The content goes on the SCENE ROOT, not on `arWorldGroup`.** The root IS
  the GPS-world frame, so map-derived content built once belongs there with no
  inverse-alignment container; the lerped alignment on `arWorldGroup` moves the
  CAMERA through a world that stands still. Two independent readers previously
  concluded the opposite, which is why `ar-scene-hierarchy.ts` states it at the
  top of the file.
- **`"gps-world-nue"` is not optional.** The demo's scene is X=East, Y=Up,
  Z=−North; the root is NUE. Attaching without it renders the city 90° off. See
  `scene-content.ts`.
- **ONE `release(endSession)` for both exits, and this is load-bearing for the
  milestones that follow.** `onSessionEnd` fires for the Android back gesture as
  well as for our own `endARSession`, so both paths reach the same function and
  it is idempotent. The single difference is a parameter: the system-end path
  must NOT call `endARSession()` on a session that is already ending.
  - An earlier version split it — `teardown()` re-attached the content while
    `dispose()` additionally released the alignment handle. That worked **by
    accident**: the only thing `dispose()` added was a handle the framework
    already reclaims via `runSessionDisposers()` before invoking `onSessionEnd`.
    **M2, M4 and M5 each add cleanup here** (the environment and camera planes,
    the draw-cost readout, the desktop renderer), and every one of them would
    have silently not run on the back gesture. **M2 has since landed and is the
    first to prove the point** — `session.restoreEnvironment` is released here,
    and a test pins that it runs on the system end specifically.
  - Content must come back whichever way the session ends: the framework
    **discards** its scene at session end, so content still attached to it is
    content the desktop view no longer has and nothing reclaims — and three.js
    reports nothing, so the symptom is an empty map view.
    - **The environment restore is a different case and a weaker one.** The
      framework rebuilds scene, camera and renderer on every `initAR`, so
      nothing there can leak into a later session; that restore is hygiene for a
      caller passing objects it does not own, not protection of shared state. An
      earlier version of this file claimed otherwise (r508 review) — the code
      was right, the reason was not.
- **`bootCompleted` guards a session that ends during a failed boot.** The
  scene-not-ready bail-out calls `endARSession`, which fires `onSessionEnd`,
  which must not run teardown against half-built state.
- **No camera, depth or hit-test features**, all of which default ON. The city's
  position comes from GPS, not vision. Depth-sensing matters most: it
  **overrides the camera's near/far planes** when a texture is present — which
  since M2 is not a future concern but a live dependency, because the 0.5 / 1000
  planes this module now sets would silently revert to the depth texture's.
- **`getCamera() === null` bails the session out**, in the same guard as the
  scene rather than treated as optional. Continuing would leave the framework's
  `0.01 / 200` in place, clipping a 2.8 km mesh at 200 m with no error anywhere.
- **`tracking.onRestarted` re-bases the odometry, and became load-bearing on
  2026-08-14.** The framework calls it on a `lost → tracking` transition that
  reset ARCore's origin; with no callback the payload is dropped and every
  pre-restart odometry position stays in a frame that no longer exists, so the
  alignment solve mixes two incompatible frames. It was harmless while the demo
  dispatched no GPS events at all; the moment `gps-registration.ts` started
  feeding the coordinator it became the difference between a converging fit and
  a city that jumps once and never recovers — a failure that reads exactly like
  a broken fusion.
  - Worse, it fails _wrongly_ rather than absently: the framework substitutes a
    fabricated zero orientation when the device-orientation cache is empty, so
    without the orientation watch the restart payload carries a confident wrong
    rotation rather than a null one. Both are wired together for that reason.
- **Narrow framework subpaths, never the barrel** — the root export pulls in
  Leaflet, which touches `window` at import time. `osm-store.ts` carries the
  same note.
- **The manual elevation nudge is summed onto the geometric offset AT THE
  `attachContentTo` CALL SITE** (DEC-E1), never inside `sceneAnchorOffsetNue`.
  That function's `up: 0` is a guarded invariant with its own test, and folding a
  user fudge into it would double-count the geoid.
  - The offset is **added to** `geometricOffset`, not substituted for it.
    Dropping the north/east terms would put the city in the wrong country, which
    is why `ar-mode.test.ts` asserts the summed vector reaches
    `attachContentTo` rather than merely asserting the call happened.
  - The control is created, attached and disposed with the session, for the
    `#ar-root` reason recorded in `ar-elevation-control.ts.md`: that element is
    `position: fixed; inset: 0` and hidden only while `:empty`, so one left
    behind covers the whole page. Teardown is asserted here.
  - **AR only.** The desktop preview attaches with `demo-scene`, which sets
    identity and discards the offset entirely.

## Examples

```ts
const mode = await startArMode({
  container: document.querySelector("#ar-root")!,
  store,
  buildingView,
  origin: selectZeroReference(store.getState()),
  onError: showError,
  onEnded: () => showMapView(),
});
// …later
mode.dispose();
```

## Tests

`ar-mode.test.ts`, with the framework's session module mocked (the reference
consumer `WayfindingHudDemo/src/ar-mode.test.ts` does the same — a real
`initAR` needs a WebXR device, and what this module owns is the wiring either
side of it).

Every failure this module can produce is silent, so each has an assertion: no
session without a fix; attachment to the scene root **and not** to
`arWorldGroup`; the frame argument present; the alignment subscription; the
feature flags off; the city not stranded when the scene is missing; the bail-out
when the camera is missing; the camera's planes actually widened; the city and
the scene environment returned on `dispose()` **and** on a system-initiated end;
and idempotent teardown, asserted as exactly two attachments rather than three.

The environment assertions are duplicated on purpose:
`ar-scene-environment.test.ts` proves the function is correct, and the ones here
prove it is **called**. M1 shipped three modules that were each correct in
isolation with nothing asserting they were connected, and four green gates
passed all three.
