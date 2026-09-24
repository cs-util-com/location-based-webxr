# `ar/sun-check-geometry.ts`

## Purpose

The pure geometry of the AR sun check (plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-0100-ar-sun-overlay-heading-check-plan.md`,
M1): the real sun's direction in the GPS world, a camera's centre ray, and
the sighting's error split into HEADING and ELEVATION. No three.js; the
marker's vertex shader has its JS twin here.

## Public API

**Units:** `sunDirectionNue` takes RADIANS (fed `solarPosition`'s
`azimuthRad` / `elevationRad` directly); every other function speaks DEGREES.

- `sunDirectionNue(azimuthRad, elevationRad)` → unit NUE `[n, u, e]`.
- `azElOfNue(v)` → `{ azimuthDeg ∈ [0, 360), elevationDeg }`; a vertical
  direction reads azimuth 0 by convention. `RangeError` for a non-unit or
  non-finite vector.
- `principalRayCamera(projection16, ndc = [0, 0])` → the unit camera-frame
  ray (+x right, +y up, −z forward) through an NDC point; reuses
  `ar/qr/qr-pose.ts`'s `intrinsicsFromProjection` on a 2×2 image (NDC
  units). NDC (0, 0) carries the principal-point offset. `RangeError` for a
  non-perspective matrix (`P[11] ≠ −1` or `P[15] ≠ 0`, e.g. orthographic) or
  non-positive focal lengths (a mirrored matrix).
- `rotateByMat4(m16, v)` → `v` rotated by a column-major matrix's rotation
  block (translation ignored, which is what makes the check blind to
  position).
- `sightingErrorDeg(rayNue, sunNue)` → `{ headingDeg ∈ (−180, 180],
elevationDeg, separationDeg }`; heading via `utils/bearing-degrees.ts`'s
  `bearingDeltaDeg`. `RangeError` when either direction is vertical (no
  heading is defined there).
- `alignmentYawDeg(m16)` → the bearing of the image of north (the first
  column) via the shared `utils/nue-bearing.ts`, [0, 360). `RangeError`
  when north maps to vertical, never a confident "north".
- `markerVertexDirection(sunAzDeg, sunElDeg, dAzDeg, uDeg, vDeg)` → a marker
  vertex's NUE direction: an anchor `dAzDeg` along the sun's almucantar
  (heading ticks; 0 for disc and rings), offset `(u, v)` degrees in the
  anchor's tangent plane (gnomonic), `u` toward increasing azimuth, `v` up.
  The offset is a true angle on the AXES only; a diagonal gnomonic offset is
  slightly shorter (0.99995° at r = 1°), so the marker's rings use a polar
  form. `RangeError` for |elevation| > 90° or offsets ≥ 89°.
- `Vec3`, `AzEl`, `SightingError`.

## Invariants & assumptions

- **Frames:** NUE (x north, y up, z east); azimuth clockwise from north.
  WebXR (x east, y up, z south) converts with the library's `webxrToNUE`
  (re-exported by the framework's `core/index.ts`; the controller imports
  it from the library, as the tests do).
- **The sign:** `h > 0` means the app believes azimuths are larger than
  they are (its directions are rotated `h` clockwise); a reticle aimed at
  the real sun reports `a_sun + h`, and on screen the virtual sun sits LEFT
  of the real one.
- **The tangent basis** is `east_t = (−sin a, 0, cos a)` (equal to
  `normalize(s × up)` for every |e| < 90°, and defined at the zenith) and
  `up_t = east_t × s` (plan review finding 2: the reverse orders mirror
  every tick).
- **Heading ticks sit on the almucantar**, not at a tangent offset: a tick
  for N heading degrees is `Δaz = N` at the sun's elevation, so its on-sky
  distance is `N · cos e` (plan §3.3).
- **Not `viewAzimuthDeg`**: the minimap's `atan2(x, −z)` convention reads a
  north-facing camera in the NUE scene as 90° (plan §2.3; a test pins it).
- Every function validates finiteness and shape and throws `RangeError`.

## Examples

```ts
const p = solarPosition(Date.now(), lat, lng, { refraction: true });
const sun = sunDirectionNue(p.azimuthRad, p.elevationRad);
const rayXr = rotateByMat4(viewTransform, principalRayCamera(projection));
const ray = rotateByMat4(alignment, webxrToNUE(rayXr));
const { headingDeg } = sightingErrorDeg(ray, sun);
```

## Tests

- `sun-check-geometry.test.ts` (known answers and edges): the compass
  directions; a vertical direction (azimuth 0, heading refused); the camera
  ray against three.js unprojection with an off-centre principal point, and
  rejection of orthographic, mirrored and malformed projections; the
  alignment yaw convention and its degenerate cases; the `viewAzimuthDeg`
  trap; the exact, signed tilt coupling (`atan(tan e · sin τ)` across the
  sun's vertical plane, pure elevation along it); the ticks at `a + N` and
  `+v` up at four (azimuth, elevation) pairs; true angles on both axes; the
  basis direction at the zenith; the range guards; and the owner's
  known-answer test, with the camera aimed from `solarPosition`'s angles by
  three.js (independent of this module) at the 265.24° Cologne golden hour:
  the marker centre lands at NDC (0, 0), and a camera yawed +2° sees it LEFT
  by `P0 · tan 2° · cos e` within 1 % (a mirrored `sunDirectionNue` fails it).
- `sun-check-geometry.property.test.ts`: an injected heading error δ read
  back as `h = δ, v = 0` through the FULL chain (random true alignment,
  camera roll, `principalRayCamera`, the view, `webxrToNUE`, the app
  alignment); invariance to the WebXR reference space's yaw; translation
  invariance; the round trip; the azimuth/elevation inverse; and the
  location choice (≤ 0.03° on the sky within 1 km of the zero reference,
  latitudes −60° to 70°, 2020-2030).
