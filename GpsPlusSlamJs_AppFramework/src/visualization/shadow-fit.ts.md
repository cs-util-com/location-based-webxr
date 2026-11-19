# shadow-fit.ts

## Purpose

The pure geometry of the cached two-map city shadow: how wide the near map
is, where its centre snaps, how strong the shadow is at a low sun, how far
toward the sun each shadow camera stands, and where each map's far plane
lies. No three.js; the three side is
[`two-map-sun-shadow.ts`](two-map-sun-shadow.ts.md).

## Public API

- `NEAR_HALF_WIDTH_STEPS`: `[120, 170, 240, 340, 480, 600]` metres, frozen.
- `SHADOW_FIT`: the defaults `{ k: 1, floorDeg: 2, fullDeg: 8, marginM: 30,
fadeFraction: 0.9 }`.
- `FADE_START_DEPTH` (0.98): where the near map's depth fade starts, in the
  map's own depth units; the shader's end is `FADE_END_DEPTH` (0.995) in
  [`two-map-shadow.ts`](two-map-shadow.ts.md).
- `nearShadowHalfWidth(cameraDistanceM, { k?, steps? })`: R = k x distance,
  rounded up to the next step and clamped to the last one. Steps make R
  change rarely, so a zoom renders the near map only when it crosses one.
- `snapShadowCentre(centre, sunDir, halfWidthM, mapSize)`: moves the centre
  by at most half a texel along the light's own x and y axes (three's
  `lookAt` basis: x = (sz, 0, -sx) / len, y = s x x), so maps rendered from
  different snapped centres put the same world point on whole-texel
  offsets and edges do not crawl when the map re-centres. Depth along the
  sun is untouched; idempotent.
- `shadowStrengthAt(elevationDeg, { floorDeg?, fullDeg? })`: 0 at or below
  the floor, 1 at or above full strength, linear between.
- `CityBox { centre, halfExtentM, maxHeightM }`: the loaded city's square
  and its tallest caster.
- `shadowCasterDistance({ centre, sunDir, halfWidthM, city, floorDeg?,
marginM? })`: D, the camera's distance from the centre along the sun:
  `max(R, min(box distance, cap)) + margin`. The box distance is the
  farthest city-box corner (at the ground and at roof height) along the
  sun; the cap is `R sqrt 2 + maxHeight / sin(floor)`.
- `nearFadeFar(D, R, fadeFraction?)`: the near map's far plane, chosen so
  that `FADE_START_DEPTH` falls `fadeFraction x R` past the centre:
  `(D + f R) / 0.98`.
- `wholeSquareFar(D, R)`: the far map's far plane, the whole square's depth
  (`D + R sqrt 2`).

Every function throws `RangeError` on non-finite input, a non-positive
distance, R, k or map size, `fullDeg <= floorDeg`, a negative height or
margin, a floor outside (0, 90) or a fade fraction outside (0, 1).

## Invariants & assumptions

- **The cap uses sin, not tan.** D is measured along the sun's ray, and a
  caster's top stands `h / sin(elevation)` up that ray from its shadow tip
  on the ground; `h / tan` is the horizontal reach. The sin form is a few
  metres larger at a 2 degree floor and is the one that holds every caster
  that can shadow the square.
- **Depth bias stays 0**: with a 24-bit depth attachment one step is under
  half a millimetre at 7 km, and the acne guard is the normal bias in
  metres, so it does not grow with D.
- **The steps are the near map's only zoom response**; a continuous R
  would re-render the near map on every zoom frame.

## Example

```ts
const R = nearShadowHalfWidth(cameraDistanceM); // 240 at 200 m
const centre = snapShadowCentre(target, sunDir, R, 2048);
const D = shadowCasterDistance({ centre, sunDir, halfWidthM: R, city });
const far = nearFadeFar(D, R);
```

## Tests

- `shadow-fit.test.ts`: examples and every refusal, plus `sunShadowPose`'s
  `farM` override.
- `shadow-fit.property.test.ts`:
  - half-width monotonicity and coverage; ramp monotonicity;
  - the snap checked through three's own shadow matrix (a fixed world
    point moves by whole texels between snapped centres), at most half a
    texel, idempotent, depth kept;
  - the fade start through three's orthographic projection (z = 0.98 at
    f R past the centre, the end below 1);
  - every caster that can shadow the square lies inside D with no margin,
    and a case where the cap binds (a huge city, the sun at the floor,
    azimuths at the diagonals). These two kill the cap mutations tan for
    sin and R for R sqrt 2.
