# globe-eye-camera.ts

- Purpose: the first-person (eye-height) camera mode's own rules (tour
  editor plan `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`
  §13 "Camera at eye height", G1 step 5; G0 spikes Q3, both in the primary
  repo's `GpsPlusSlamJs_Docs/docs/`). G0 found frame time was not what kept
  the globe's camera from eye height (p95 at most 3.4 ms on a desktop);
  its rules were: the flight's 100 m clearance (`GLOBE_FLIGHT.clearanceM`,
  enforced every frame), the tile library's controls (10 m least
  distance, 5 m camera radius) and a near plane of 0.3 x the height that
  clipped items within 12 m at 40 m.
- Public API:
  - `GLOBE_EYE`: `clearanceM` 1.7 (the least height over the drawn
    ground), `nearFraction` 0.3 (the globe's), `itemShare` 0.5, `minNearM`
    0.1, `controls` `{ cameraRadius: 1.7, minDistance: 0.5 }` (the
    radius is the clearance, one constant), `depth`
    `{ reversedDepthBuffer: false, logarithmicDepthBuffer: false }`
    (spread into the app's `WebGLRenderer` options).
  - `eyeNearM(clearanceM, nearestItemM = Infinity)`: max(`minNearM`,
    min(0.3 x clearance, 0.5 x item)). RangeError for a clearance that is
    not finite and >= 0, or an item distance below 0 or NaN.
  - `eyeClipPlanes(ellipsoid, position, { clearanceM?, nearestItemM?,
peakM? })`: `eyeNearM` of the clearance capped by the height above
    the ellipsoid (the globe's own surface is drawn too; it stands in when
    there is no clearance), and `clipPlanes`' far plane (past the horizon,
    a peak's horizon added). `position` is in the ellipsoid's frame, as
    for `clipPlanes`.
  - `nearestItemDistanceM(position, spheres)`: the distance to the
    nearest bounding sphere's surface (0 inside, Infinity without; empty
    spheres skipped).
  - `applyEyeControls(controls)`: sets `cameraRadius` and `minDistance`
    to this mode's and returns a function that restores the old values.
- Invariants & assumptions:
  - The mode never touches `GLOBE_FLIGHT`: an app switches the clearance
    it enforces, the controls' limits and the plane rule together.
  - Depth: standard by default (G1 review L4), never logarithmic (G0:
    logarithmic lost decal pixels at 2 and 4 km; standard and reversed
    drew them all). Reversed depth gains precision only with a
    floating-point depth buffer (a render target with a `FloatType` depth
    texture, or a float default framebuffer, which WebGL does not give):
    with the default 24-bit integer buffer G0 measured it equal to
    standard, and the shaders that read the scene's depth (the globe
    lab's cloud volume and space pass) assume standard. An app that renders into
    a float-depth target may pass `reversedDepthBuffer: true` itself;
    three needs `EXT_clip_control` for it (it falls back to standard with
    a console warning), and `renderer.capabilities.reversedDepthBuffer`
    says which one it got.
  - The near plane is never below 0.1 m (G0's 0.05-0.1 m range), so the
    depth range stays finite at the feet; the controls' own
    `stableDistance` also uses `camera.near`.
  - Pure apart from `applyEyeControls`, which writes two numbers.
- Example:

  ```ts
  const renderer = new THREE.WebGLRenderer({ canvas, ...GLOBE_EYE.depth });
  const restore = applyEyeControls(controls);
  // each frame, after every camera writer:
  const { near, far } = eyeClipPlanes(ellipsoid, cameraInTilesFrame, {
    clearanceM,
    nearestItemM: nearestItemDistanceM(camera.position, itemSpheres),
  });
  ```

- Tests: `globe-eye-camera.test.ts` (the clearance is not the flight's,
  the depth options, the near plane's three rules and its refusals, the
  far plane kept, the ellipsoid cap, the nearest item, the controls
  lowered and restored, at the mode's own clearance) and
  `globe-eye-camera.property.test.ts` (invariants: positive, never
  below the floor, never above the larger of the floor and either share,
  below the item when the item is beyond twice the floor, never growing
  as the ground or an item comes closer). The globe lab's
  `globe-editor-blocks.smoke.spec.mjs` holds the mode on the page.
