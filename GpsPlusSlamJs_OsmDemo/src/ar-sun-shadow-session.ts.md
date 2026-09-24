# ar-sun-shadow-session.ts

## Purpose

The AR sun shadow prototype's session (plan
`GpsPlusSlamJs_Docs/docs/2026-09-23-2343-ar-sun-shadow-prototype-plan.md`,
§10, M3c; the M3 review fixes in §11.1): what `ar-mode.ts` runs once per XR
frame under `?sunShadow=1`. It owns:

- the real sun;
- whether the shadow is on;
- the framework's shadow-casting light;
- the receiving plane and the test pole;
- the frame times.

The frame loop only hands it numbers it already computes, so every decision
is unit-tested without a WebXR session (no e2e can enter AR).

## Public API

- `tryStartArSunShadow({ scene, renderer, view, origin, geometricOffset, demAt, nowMs? })`
  is what `ar-mode.ts` calls. It returns `{ session }`, or
  `{ unavailable }` with the reason for the HUD, and never throws.
  - `renderer` may be null ("no renderer"), `origin` may be null ("no
    position fix"), and `demAt` may be undefined ("auto elevation is off":
    without the floor estimate the shadow could never come on).
  - A scene without the named sun light gives that error's message.
  - A refusal touches nothing: no shadow maps, no props, no casting.
- `startArSunShadow(deps)` returns an `ArSunShadowSession`.
  - It turns the renderer's shadow maps on, adds the plane and the pole
    (hidden) to the placed content through the view's seams, and turns
    casting on.
  - `deps.demAt(enu)` is the AR-datum-gated DEM sampler in anchor ENU (the
    auto-elevation group's `terrainHeightM`).
  - Throws when the scene has no named sun light (`SCENE_NODE.SUN_LIGHT`).
- `session.frame({ dtS, userEnu, forwardEnu, composedM, floorEngaged })`
  returns an `ArSunShadowStatus`:
  - `state`;
  - `sunElevationDeg`;
  - `renders` (shadow maps this session);
  - `frameTimes` (p50 / p95 / max);
  - `lastMapFrameMs` (the time of the frame that drew the latest map);
  - `error` (when `state` is `failed`).
- `session.dispose()`: gives the light back, turns casting off, removes and
  frees the props. Idempotent.
- `describeArSunShadow(status)`: the HUD line.
- Types: `ArShadowView` (the BuildingView seams), `ArSunShadowDeps`,
  `ArSunShadowStartInputs`, `ArSunShadowFrame`, `ArSunShadowStatus` (its
  `state` is one of `on`, `waiting-for-position`, `waiting-for-floor`,
  `sun-low`, `failed`; the union type itself stays module-internal),
  `ArSunShadowSession`.

## Invariants & assumptions

- **On only when all hold, checked in this order** (the HUD names the first
  that fails):
  - a position: aligned, with a finite gated DEM there;
  - the floor estimate is `engaged`;
  - the sun is at or above 10°.
  - Otherwise the `SunShadow` is disposed, so the fixed (0, 10, 5) light is
    back exactly as it was, and the props hide.
- **Every switch-on recompiles the lit materials.** three keys its programs
  on a CASTING light, not on `renderer.shadowMap.enabled`, so turning shadow
  maps on before the first XR frame does not spare the recompile: it
  happens when the shadow first comes on, and again at each off-to-on
  switch. The floor's hysteresis keeps that rare. Keeping the light casting
  for the whole session would compile once, but it breaks "the fixed light
  back exactly"; that choice is parked for the owner (plan §11.1, M2).
- **A frame that throws fails the session once and for good.** It gives
  the light back, hides the props, and reports `failed` with the message,
  instead of aborting the rest of the AR frame callback every frame.
- **Two frames.**
  - The props live in the content root's DEMO frame (x east, y up, −z north),
    each on the DEM under itself: the plane under the user, the pole under
    the pole. The root adds the composed offset, as it does for every object.
  - The rig's centre is in the scene root's NUE frame: anchor ENU plus the
    geometric offset, and DEM plus the composed offset.
  - The caster offset is the composed offset, with the rig's 1 cm threshold.
    **While the elevation eases (1.5 m/s, about 2.5 cm a frame) that
    re-renders the map every frame.** It is recorded rather than fixed; the
    real fix is new machinery and parked for the owner (plan §11.1, M3).
- **The pole is placed ONCE**, 3 m ahead of the camera (north without a
  forward), when the shadow first comes on, on the DEM at that point (the
  DEM under the user when the sampler has nothing there).
- **The sun at most once a second**, from `Date.now` (the XR clock stalls in
  suspend) and the zero reference, with refraction (the real shadow follows
  the apparent sun).
- **The map frame is the NEXT callback's `dt`.** The map renders in the
  renderer's render, after the frame callbacks, so the frame that scheduled
  it cannot time it. A frame that drew no map leaves the value alone. The
  first map after each switch-on is not reported, because that frame also
  carries the recompile.
- **The frame times come from every frame's `dt`**, because the HUD's fps is
  a window mean, blind to the one frame that renders a map.

## Example

```ts
const started = tryStartArSunShadow({
  scene,
  renderer: getRenderer(),
  view: buildingView,
  origin,
  geometricOffset,
  demAt: autoElevation?.terrainHeightM,
});
session.sunShadow = started.session;
unavailable = started.unavailable; // for the HUD
// per frame:
const status = session.sunShadow?.frame({
  dtS: dt,
  userEnu,
  forwardEnu,
  composedM,
  floorEngaged,
});
hudLine = status && describeArSunShadow(status);
```

## Tests

`ar-sun-shadow-session.test.ts` (a fake scene with the named light, a fake
renderer and view, a fixed clock: Cologne on 21 June at 12:00 UTC and at
midnight) covers:

- the start, and the refusal without the light;
- each refusal of `tryStartArSunShadow`, touching nothing;
- each off state in order, a non-finite DEM included;
- the plane under the user and the pole 3 m ahead along a diagonal forward,
  on a sloped DEM;
- the light at the rig pose, D away, above and on the sun's (south) side;
- no new map for the same state;
- the fixed light given back, the props hidden, and a fresh map on return;
- the frame times;
- the map frame's own time, the switch-on skip, and the HUD suffix;
- the one-time failure;
- dispose;
- the HUD lines.

The wiring (the DEM sampled under the camera through the frame conversion,
the refusal without auto elevation) is pinned in `ar-mode.test.ts`.
