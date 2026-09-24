# ar-sun-shadow-session.ts

## Purpose

The AR sun shadow prototype's session (plan
`GpsPlusSlamJs_Docs/docs/2026-09-23-2343-ar-sun-shadow-prototype-plan.md`,
§10, M3c): what `ar-mode.ts` runs once per XR frame under `?sunShadow=1`. It
owns:

- the real sun;
- whether the shadow is on;
- the framework's shadow-casting light;
- the receiving plane and the test pole;
- the frame times.

The frame loop only hands it numbers it already computes, so every decision
is unit-tested without a WebXR session (no e2e can enter AR).

## Public API

- `startArSunShadow({ scene, renderer, view, origin, geometricOffset, nowMs? })`
  returns an `ArSunShadowSession`.
  - It turns the renderer's shadow maps on, adds the plane and the pole
    (hidden) to the placed content through the view's seams, and turns
    casting on.
  - Call it during the session's synchronous setup, so shadow maps exist
    before the first XR frame.
  - Throws when the scene has no named sun light (`SCENE_NODE.SUN_LIGHT`).
- `session.frame({ dtS, userEnu, forwardEnu, demAtUserM, composedM, floorEngaged })`
  returns an `ArSunShadowStatus`: `state`, `sunElevationDeg`, `renders`
  (shadow maps this session), `frameTimes` (p50 / p95 / max) and
  `lastMapFrameMs` (the time of the frame that drew the latest map).
- `session.dispose()`: gives the light back, turns casting off, removes and
  frees the props. Idempotent.
- `describeArSunShadow(status)`: the HUD line.
- Types: `ArShadowView` (the BuildingView seams), `ArSunShadowDeps`,
  `ArSunShadowFrame`, `ArSunShadowState`, `ArSunShadowStatus`,
  `ArSunShadowSession`.

## Invariants & assumptions

- **On only when all hold, checked in this order** (the HUD names the first
  that fails):
  - a position: aligned, with the gated DEM known there;
  - the floor estimate is `engaged`;
  - the sun is at or above 10°.
  - Otherwise the `SunShadow` is disposed, so the fixed (0, 10, 5) light is
    back exactly as it was, and the props hide. Each switch recompiles the lit
    materials once; the floor's hysteresis keeps that rare.
- **Two frames.**
  - The props live in the content root's DEMO frame (x east, y up, −z north)
    at the DEM height. The root adds the composed offset, as it does for
    every object.
  - The rig's centre is in the scene root's NUE frame: anchor ENU plus the
    geometric offset, and DEM plus the composed offset.
  - The caster offset is the composed offset, so an easing root re-renders
    the map only every centimetre.
- **The pole is placed ONCE**, 3 m ahead of the camera (north without a
  forward), when the shadow first comes on.
- **The sun at most once a second**, from `Date.now` (the XR clock stalls in
  suspend) and the zero reference, with refraction (the real shadow follows
  the apparent sun).
- **The map frame is the NEXT callback's `dt`.** The map renders in the
  renderer's render, after the frame callbacks, so the frame that scheduled
  it cannot time it. A frame that drew no map leaves the value alone.
- **The frame times come from every frame's `dt`**, because the HUD's fps is
  a window mean, blind to the one frame that renders a map.

## Example

```ts
session.sunShadow = startArSunShadow({
  scene,
  renderer,
  view: buildingView,
  origin,
  geometricOffset,
});
// per frame:
const status = session.sunShadow.frame({
  dtS: dt,
  userEnu,
  forwardEnu,
  demAtUserM,
  composedM,
  floorEngaged,
});
hudLine = describeArSunShadow(status);
```

## Tests

`ar-sun-shadow-session.test.ts` (a fake scene with the named light, a fake
renderer and view, a fixed clock: Cologne on 21 June at 12:00 UTC and at
midnight) covers:

- the start;
- the refusal without the light;
- each off state in order;
- the plane under the user and the pole 3 m ahead;
- the light at the rig pose, D away;
- no new map for the same state;
- the fixed light given back and a fresh map on return;
- the frame times;
- the map frame's own time, and its HUD suffix;
- dispose;
- the HUD lines.
