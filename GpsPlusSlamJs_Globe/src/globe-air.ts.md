# globe-air.ts - the air's per-frame wiring

- Purpose: what the globe's three air drawers (the space pass over the
  Earth, the framework's ground sky, the haze over the relief) are told
  each frame and in which order (globe F2 plan 2026-10-03-1922, F2b),
  moved out of the globe lab as a pure refactor. The drawers themselves
  stay the lab's (`labs/globe/globe-atmosphere.js`, `globe-ground-sky.js`,
  `globe-haze.js`): they build on the framework's atmosphere, which this
  package does not import yet, so they are passed in.
- Public API:
  - `createGlobeAir({ ellipsoidRadii, groundRadiusKm, sun, globeGroup,
spacePass, groundSky, haze })` returns `GlobeAir`:
    - `step(params, { cameraEcef, framed })`, once a frame after the clip
      planes: the observer's height over the ellipsoid's image
      (`observerAltitudeKm`, km), the sun turned into the world by the
      globe group's matrix, then either the ground sky's `update` (when
      `groundSky` is 1 and `sky` is not 0; its width never wider than the
      edge) or the space view's values (`{ weight: 0, exposure:
sunIntensity }`); then the haze's `sync` after a ground-sky frame
      whose stage was `read`, and the haze's `setWeight(weight,
hazeScale)`. RangeError for a camera that is not finite.
    - `finish(params)`, after the cloud volumes' updates: the sun's
      intensity becomes the eased exposure; the shell's thickness is
      `shellThicknessAt(max(0, observerKm), atmoThickness)` with
      `atmoRamp` 1, `atmoThickness` otherwise, set on the space pass only
      when it changed.
    - `render(camera, params, { drawn, worldFromEcef, sunEcef, sceneDepth
})`: the space pass, its sky share `1 - weight`, its ground share 1
      (or `1 - weight` with `atmoGround` 0), its scene depth weighted by
      the weight; nothing when `drawn` is false.
    - `observerKm()`, `weight()`, `groundSkyState()` (the ground sky's
      `state()` plus `observerAltitudeKm`) for the lab's other passes and
      its `state()` adapter.
  - `params` carries the lab's hash names: `groundSky`, `sky`,
    `skyEdgeKm`, `skyWidthKm`, `skyStepPct`, `sunIntensity`, `hazeScale`,
    `atmoRamp`, `atmoThickness`, `atmoGround`; the lab passes its `params`.
- Invariants & assumptions:
  - The lab's order is kept: `step` between the clip planes and the cloud
    volumes' updates, `finish` after them (the volumes update with the
    frame's previous sun intensity, as before the move), `render` after
    the cloud volumes' draws.
  - Before the first `step` the weight is 0, the exposure NaN and the
    observer at +Infinity, as the lab's initial values.
  - The ground sky's `state()` is read every frame (its stage decides the
    haze's sync); the haze is synced only after a `read` stage, which
    implies the framework sky exists.
  - The shell's look is a shader setting: it is set only when the
    thickness changes. The lab's live controls also set the far thickness
    on the space pass directly; the cache here is not told, as before.
- Examples:

  ```ts
  const air = createGlobeAir({
    ellipsoidRadii: [radii.x, radii.y, radii.z],
    groundRadiusKm: EARTH_ATMOSPHERE.groundRadiusKm,
    sun: globe.sun,
    globeGroup: globe.group,
    spacePass: atmosphere,
    groundSky,
    haze,
  });
  air.step(params, { cameraEcef, framed: frameTarget() !== null });
  // ... the cloud volumes ...
  air.finish(params);
  ```

- Tests: `globe-air.test.ts` (the ground sky's inputs and the narrowed
  width; the ground sky left alone when off; the haze's sync only after a
  read and its weight; the sun's intensity set in `finish`; the shell's
  thickness by the ramp, only on change, from 0 km below the ellipsoid;
  the space pass's shares; the state; a non-finite camera refused).
