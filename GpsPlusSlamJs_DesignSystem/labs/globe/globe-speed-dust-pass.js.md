# globe-speed-dust-pass.js

The speed dust's pass in the globe lab: draws the pure model
(`/globe/globe-speed-dust.js`) as streaks pouring past the camera. Round-3
plan `GpsPlusSlamJs_Docs/docs/2026-10-08-2345-globe-round-3-owner-feedback-plan.md`, D1.

## API

`createSpeedDustPass(maxCount = SPEED_DUST_MAX_COUNT)` (4,000, the panel's
`dustCount` maximum, exported) holds a field of `maxCount` seeds
and draws a prefix of it (a prefix of a uniform field is uniform), so the
count is a live knob (D1b). `SPEED_DUST_COLORS`: the tints (bluish white,
white, warm). It returns:

- `update({ nowMs, position, quaternion, altitudeM, fovDeg, aspect,
renderer, on, exposureMs, widthPx, look })`: each frame, with the
  camera's ECEF pose; `look` holds the panel's knobs, each the default
  when absent: `count`, `gain` (on the opacity), `color` (an index into
  `SPEED_DUST_COLORS`), `loMps`, `hiMps`, `driftMin`, `driftMax`. Steps the
  velocity (a jump of the altitude in a frame resets it), the speed share, the opacity (nothing when off, stopped or
  below 300 km), the field's drift and the streaks; sets the dust camera to
  the view's ECEF orientation, field of view and aspect.
- `render(renderer, weight)`: the streaks at `weight` (no-op when not shown).
  The lab draws them before the Earth at 1 - `dustOver` and after it at
  `dustOver`.
- `reset()`: forgets the velocity (a placed view is a teleport).
- `state()`: `{ count, gain, color, loMps, hiMps, driftMin, driftMax,
speedMps, share, opacity, drift, direction, shown }` (the knobs as applied,
  so a smoke can see every one). A range that is not a positive rising
  pair falls back to the default instead of throwing every frame.
- `sample(n)`: the first n visible streaks projected (heads and tails as
  normalised screen points, 0 at the top-left) and the focus of expansion
  (where the motion points on screen, or null when it is behind).
- `dispose()`.

## How it draws

- Instanced quads, one per particle: the vertex shader projects the head
  and the tail with the dust camera (at the origin, ECEF orientation, near
  0.01, far 10: the main camera's near plane at 0.3 x the altitude would
  clip exactly the near, fast streaks), clips a tail behind the camera to
  the near plane, and spans the quad between them at `widthPx` (at least a
  dot when slow).
- Long streaks spread their light (the energy of a dot, at least 0.15 of
  it), brightest at the head; additive, no depth, its own scene.
- The field lives in ECEF axes: the lab rotates its world frame to the fix
  mid-flight, which would spin a world-axis field around the camera.

## Tests

`globe-dust.smoke.spec.mjs`: nothing drawn by default; during a flight the
streaks show high up and point away from the focus of expansion; once
landed and stopped, nothing.
