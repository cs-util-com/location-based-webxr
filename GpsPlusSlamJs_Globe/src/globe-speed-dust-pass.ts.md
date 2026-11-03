# globe-speed-dust-pass.ts

- Purpose: the speed dust's drawing pass: the pure model
  (`globe-speed-dust.ts`) drawn as streaks pouring past the camera. Moved
  from the globe lab (`GpsPlusSlamJs_DesignSystem/labs/globe/`, which
  imports it as `/globe/globe-speed-dust-pass.js`) so the Tour Viewer's
  editor draws the same streaks on its approach. Round-3 plan
  `GpsPlusSlamJs_Docs/docs/2026-10-08-2345-globe-round-3-owner-feedback-plan.md`, D1;
  the editor's use: `2026-11-03-0005-tour-editor-r1019-feedback-plan.md`.
- Public API:
  - `createSpeedDustPass(maxCount = SPEED_DUST_MAX_COUNT)` (4,000, the lab
    panel's `dustCount` maximum) holds a field of `maxCount` seeds and
    draws a prefix of it (a prefix of a uniform field is uniform), so the
    count is a live knob. It returns a `SpeedDustPass`:
    - `update(frame: SpeedDustFrame)`: `{ nowMs, position, quaternion,
altitudeM, fovDeg, aspect, renderer, on, exposureMs, widthPx,
radialOnly?, look? }`, each frame, with the camera's ECEF pose.
      `radialOnly` passes to the model's `stepVelocity` (only the distance
      to the Earth makes streaks). `look` holds the knobs, each the default
      when absent: `count` (default `SPEED_DUST_LOOK.count`, also for a count
      that is not finite), `gain` (on the opacity, default
      `SPEED_DUST_LOOK.gain`), `farShare` (0..1), `color` (an index into
      `SPEED_DUST_COLORS`), `loMps`, `hiMps`, `driftMin`, `driftMax`. Steps
      the velocity (a jump of the altitude in a frame resets it), the speed
      share, the opacity (nothing when off, stopped or below 300 km), the
      field's drift and the streaks; sets the dust camera to the view's
      ECEF orientation, field of view and aspect. Off still measures the
      speed (its `state()` reads it), and draws nothing.
    - `render(renderer, weight)`: the streaks at `weight` (no-op when not
      shown or the weight is not positive). A page draws them before the
      Earth at 1 - `over` and after it at `over`.
    - `reset()`: forgets the velocity (a placed view is a teleport).
    - `state()`: `{ count, gain, farShare, color, loMps, hiMps, driftMin,
driftMax, speedMps, share, opacity, drift, direction, shown }`, the
      knobs as applied, so a check sees every one.
    - `sample(n = 200)`: the first n visible streaks projected (heads and
      tails as normalised screen points, 0 at the top-left) and the focus
      of expansion (where the motion points on screen, or null behind).
    - `dispose()`: frees the geometry and the material; safe twice.
  - `SPEED_DUST_LOOK`: `{ count: 2500, gain: 2, exposureMs: 60, widthPx:
1.5, over: 0.25 }`, the look picked from four A/B looks (DEC-R3-17,
    look C): the lab's knob defaults and the editor's look.
  - `SPEED_DUST_COLORS`: the tints (bluish white, white, warm).
  - `SPEED_DUST_MAX_COUNT`.
- Invariants & assumptions:
  - Instanced quads, one per particle: the vertex shader projects the
    head and the tail with the dust camera (at the origin, ECEF
    orientation, near 0.01, far 10: the main camera's near plane would clip
    exactly the near, fast streaks), clips a tail behind the camera to the
    near plane, and spans the quad between them at `widthPx` x the pixel
    ratio (at least a dot when slow).
  - Long streaks spread their light (the energy of a dot, at least 0.15 of
    it), brightest at the head; additive, no depth test or write, its own
    scene, never frustum-culled.
  - The field lives in ECEF axes: a page that rotates its world frame
    mid-flight would otherwise spin the field around the camera.
  - Defensive: a range that is not a positive rising pair falls back to
    the model's default instead of throwing every frame; a gain that is
    negative or not finite reads as the look's (2), a count that is not
    finite as the look's (2,500), a far share outside 0..1 as the default, an unknown colour
    as 0; the count is clamped to 1..`maxCount`.
  - Performance: one draw call of up to `maxCount` instances, the
    attributes uploaded only over the drawn prefix and only when shown.
    The model writes each frame's streaks straight into the attribute
    arrays (`streaks(..., out)`): no typed array is made per frame (a
    unit test counts them and times 120 frames at 2,500 in Node).
- Examples:
  ```ts
  const dust = createSpeedDustPass();
  // beforeScene
  dust.update({
    nowMs,
    ...view.ecefCamera(),
    altitudeM,
    fovDeg: camera.fov,
    aspect: camera.aspect,
    renderer,
    on: true,
    exposureMs: SPEED_DUST_LOOK.exposureMs,
    widthPx: SPEED_DUST_LOOK.widthPx,
    look: { count: SPEED_DUST_LOOK.count, gain: SPEED_DUST_LOOK.gain },
  });
  dust.render(renderer, 1 - SPEED_DUST_LOOK.over);
  // afterScene
  dust.render(renderer, SPEED_DUST_LOOK.over);
  ```
- Tests: `globe-speed-dust-pass.test.ts` (shown at speed and height,
  nothing stopped, low or off, reset, the draw weights, width and viewport,
  the dust camera's pose, the knob fallbacks, the count prefix, the
  sample, the shared look's gain and count as fallbacks, no typed array
  made per frame and a generous Node time budget at 2,500, dispose freeing
  the geometry and the material); the lab's `globe-dust.smoke.spec.mjs` in a browser; the
  Tour Viewer's `editor3d-globe-start.spec.js` on the editor's approach.
