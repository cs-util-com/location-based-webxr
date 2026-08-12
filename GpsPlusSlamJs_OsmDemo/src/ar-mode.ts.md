# `ar-mode.ts`

## Purpose

Starts a WebXR session, hands the already-built city to the framework's scene
graph in the right frame, subscribes the world group to the fusion's alignment,
and gives the city back on the way out.

## Scope — AR milestone 1

**In:** the session lifecycle, the attachment, the alignment subscription, and
teardown on both the app-initiated and system-initiated exits.

**Out:** lighting, fog, `scene.background`, materials (M2); the distance gate
and far-travel warning (M3); the draw-cost readout (M4); the UI and the
desktop-renderer lifecycle (M5).

M2 is deliberately separate rather than folded in here: this demo has a
recorded history of a wrong scene environment making every
`MeshStandardMaterial` **fail to compile and silently not draw for ten work
items while every assertion stayed green**, so it gets its own step with its own
verification.

## Public API

- `ArModeDeps` — `{ container, store, buildingView, origin, onError, onEnded? }`.
  - `store` is typed `SubscribableStore`, not the concrete `SlamAppStore`: that
    type's shape changes with the demo's `extraReducers` and this module only
    subscribes.
  - `origin` is the framework's `zero`, read by the caller. `null` means no fix.
- `startArMode(deps): Promise<ArMode>` — **never rejects.** A refused session,
  an unsupported device and a missing GPS fix are ordinary outcomes the page
  renders, not exceptions; all of them reach the user through `onError` and
  return an inert handle.
- `ArMode` — `{ dispose() }`, idempotent.

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
- **Teardown re-attaches the content, and runs on BOTH exits.** The framework's
  scene outlives this session, so content left there is content the desktop view
  no longer has and nothing reclaims — and three.js reports nothing, so the
  symptom is an empty map view. `onSessionEnd` fires for the Android back
  gesture as well as for our own `endARSession`, so both paths reach it and
  teardown is idempotent.
- **`bootCompleted` guards a session that ends during a failed boot.** The
  scene-not-ready bail-out calls `endARSession`, which fires `onSessionEnd`,
  which must not run teardown against half-built state.
- **No camera, depth or hit-test features**, all of which default ON. The city's
  position comes from GPS, not vision. Depth-sensing matters most: it
  **overrides the camera's near/far planes** when a texture is present, which
  would silently invalidate M4's far-plane work.
- **Narrow framework subpaths, never the barrel** — the root export pulls in
  Leaflet, which touches `window` at import time. `osm-store.ts` carries the
  same note.

## Examples

```ts
const mode = await startArMode({
  container: document.querySelector("#app")!,
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
feature flags off; the city not stranded when the scene is missing; the city
returned on `dispose()` **and** on a system-initiated end; and idempotent
teardown, asserted as exactly two attachments rather than three.
