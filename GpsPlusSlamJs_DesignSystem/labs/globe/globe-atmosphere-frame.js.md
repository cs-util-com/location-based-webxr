# labs/globe/globe-atmosphere-frame.js - the atmosphere pass's numbers and frame

- Purpose: the pure part of the globe's atmosphere pass (round-4 plan
  2026-09-28-2105 DEC-GL4-4, `globe-atmosphere.js`): its look defaults and
  ranges, and the map from ECEF metres to the framework model's frame, free
  of imports so Node's own runner tests it.
- Public API:
  - `GLOBE_ATMOSPHERE` - the defaults: `steps` (samples per ray), `strength`
    (a scale on the physical light, 1 = as computed), `thickness` (the
    shell drawn this many times thicker than the real air at the same
    optical depth, 1 = physical), `visibilityKm` (the aerosol density, the
    framework's 60 km).
  - `defaultAtmosphereSteps(coarsePointer)` - `coarseSteps` (8) where
    the primary pointer is coarse (a touch screen), `steps` (12) otherwise
    (review B5: the march cost x3.9 against x4.6 at the phone tier's pixel
    ratio 2, with no ring measured from 6 samples up).
  - `chapman(x, mu)`, `grazingCompensation(k, mu, x)`, `CHAPMAN_GLSL` -
    Chapman's grazing function (1 / (mu + 1 / sqrt(pi x / 2))) and the
    factor a ray's steps need in a k times thicker shell to keep the real
    air's optical depth (review B2): sqrt(k) at the limb, 1 at k = 1, at
    most 1.06 straight down and 1.12 at 60 degrees for k up to 10; the
    GLSL twin is what the pass's march includes.
  - `atmosphereLook(input)` - `{ steps, strength, thickness }`, each from
    `input` or the default, the steps rounded; RangeError outside steps
    2-64, strength 0-4, thickness 1-10 or for a non-finite value.
  - `ellipsoidToModel([a, b, c], groundKm)` - per-axis factors (km per
    metre) that put the ellipsoid of radii a, b, c exactly on the model's
    ground sphere of `groundKm`; RangeError for a radius or ground that is
    not a positive finite number.
- Invariants & assumptions:
  - The map is affine, so rays stay straight and the pass intersects
    spheres analytically; it stretches lengths by at most the flattening
    (0.34 %), below anything the look can show.
  - The steps become a GLSL loop bound (a `#define`), so they are refused
    rather than clamped: a bad hash value falls back to the default before
    it reaches here (the lab's `readParam`), and anything else is a bug.
- Examples:

  ```js
  const k = ellipsoidToModel([6378137, 6378137, 6356752.3], 6360);
  const look = atmosphereLook({ steps: 12 }); // { steps: 12, strength: 1, thickness: 6 }
  ```

- Tests: `globe-atmosphere-frame.test.mjs` (the compensation: 1 at k = 1,
  sqrt(k) at the limb, near 1 for a steep ray, monotonic; every point of the ellipsoid
  on the ground sphere; altitudes kept within 0.4 %; refusals; the look's
  defaults, rounding and ranges).
