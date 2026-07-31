# `sun.ts` — where the sun is, given where the camera is

## Purpose

Computes the scene's single sun direction from the camera's azimuth, so the
specular highlight that reveals terrain relief is never lost as the view orbits.

## Public API

- `SUN_AZIMUTH_OFFSET_RAD` (π/4) — how far to the side of the camera the sun sits.
- `SUN_ELEVATION_RAD` (π/6) — its fixed height above the horizon.
- `MIN_SUN_EYE_ANGLE_RAD` (π/8) — the floor the property test asserts.
- `Vector3Like` — `{ x, y, z }` in the render frame (`+x` east, `+y` up, `−z` north).
- `cameraAzimuth(camera, target): number` — radians, measured from the
  camera→target offset. `0` for a camera directly overhead.
- `sunDirection(cameraAzimuthRad): Vector3Like` — a **unit** vector pointing from
  the scene towards the sun.

## Invariants & assumptions

- **The sun is never at the eye, and that is the whole point.** A light at the
  camera makes N·L maximal and nearly constant for every surface facing the
  viewer — the flash-photography look — which flattens the contours the
  reflective ground (DEC-R2-1) exists to reveal. The notes' first instinct was a
  headlight and DEC-R4-6 records the reversal. `MIN_SUN_EYE_ANGLE_RAD` is the
  formal statement of it and `sun.property.test.ts` asserts it over the whole
  reachable camera dome, not at sampled angles.
- **The elevation is fixed and low.** Grazing light turns a small height
  difference into a long tonal gradient; a high sun lights every facet about
  equally. This is the same reasoning as cartographic hillshading.
- **`cameraAzimuth` measures from the TARGET, not from world zero.** After a pan
  both are far from the origin, and an azimuth taken from world zero would swing
  while the user is only sliding sideways — the sun would spin during a pan.
- **The vector is unit-length.** A `DirectionalLight` has no falloff, so the
  distance is the caller's rendering detail.
- **ONE sun vector.** `building-view.ts` drives both the `DirectionalLight` and
  (from W14) the sky's painted sun disc from this function. Two independent sun
  positions would be visible as a sky sun that disagrees with the highlights.
- **No frame loop is added.** The sun is re-aimed from the controls' `change`
  handler, which fires exactly when a frame is already being scheduled;
  DEC-R3-9's on-demand renderer is untouched.
- **Physically dishonest, and accepted** (DEC-R4-6): the sun moving when you turn
  is not what the sun does. The trade is that the scene keeps its relief from
  every angle instead of one.

## Examples

```ts
const direction = sunDirection(cameraAzimuth(camera.position, controls.target));
light.position.set(direction.x * 1000, direction.y * 1000, direction.z * 1000);
```

## Tests

`sun.property.test.ts` — over a generated camera dome: the sun-to-eye angle never
falls below the floor, the elevation is constant and above the horizon, the
vector is unit-length, and the sun genuinely moves with the camera (an offset of
zero would satisfy every other assertion). Plus two examples for `cameraAzimuth`:
that it is measured from the target, and that straight overhead is `0` rather
than `NaN`.
