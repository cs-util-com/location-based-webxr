# globe-ground-hit.ts

- Purpose: where a ray meets the globe's ground, from the relief's SAMPLED
  heights (tour editor plan `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`
  §13 "Picking and dragging", G1 step 4; G0 spikes Q2, both in the primary
  repo's `GpsPlusSlamJs_Docs/docs/`). The relief's own raycast reads the
  drawn mesh, which the globe's stencil fill blocks and which changes with
  the level of detail; the spike's march over sampled heights was 10-20
  times cheaper, missed none of 40 drags and gave the same height at every
  level. This is that march, made a module.
- Public API:
  - `GROUND_HIT`: the defaults (5 km reach, steps of max(1 m, 2 % of the
    distance), 24 halvings of the crossing's step).
  - `marchToGround(ray, aboveGround, options?)`: the first distance `t`
    where `aboveGround` goes from > 0 to <= 0 along the ray (normalised
    first), as `{ t, point, samples, nulls }`; null when the ray stays
    above the ground within `maxDistanceM`, starts on or below it, or
    finds nothing loaded. Options: `startM`, `maxDistanceM`, `minStepM`,
    `stepFraction`, `bisections` (1-60). RangeError for a zero or
    non-finite direction or an option out of range.
  - `terrainAboveGround(terrain)`: an `AboveGround` over a
    `createGlobeTerrain` result: a world point into the tiles' frame (the
    group's world matrix, read once when called), to latitude, longitude
    and height on the ellipsoid, minus the plugin's
    `sampleCartographicElevation`; null where no heights are loaded.
  - `groundHit(terrain, ray, options?)`: the two together, for a
    WORLD-space ray.
- What G2 (the editor's picking) uses:
  - a ray from `THREE.Raycaster.setFromCamera(ndc, camera)` (its `.ray`),
    passed to `groundHit(terrain, raycaster.ray)`;
  - `t` to tell an item in front of the ground (its own hit closer than
    `t`) from one behind a hill;
  - `point` as the drag target, then `ellipsoidalHeightM`
    (`globe-heights.ts`) for what the item saves;
  - `startM` to skip a stretch the editor already knows (e.g. the camera's
    own near plane).
  - Read `terrainAboveGround` again after the globe's group moves (it
    caches the inverse matrix); a pick per pointer event is fine, it is
    cheap (about 60-300 samples).
- Invariants & assumptions:
  - The ground is what the plugin samples: the loaded tile's heights at
    its own level. Across a tile seam or a level change the sample is
    continuous enough that the bisection lands within the step it found
    (tested); a ridge thinner than one step can be stepped over (2 m at
    100 m, 100 m at 5 km).
  - A sample with no heights (null, or a non-finite value) never brackets
    a crossing: the step is skipped and counted in `nulls`.
  - A ray that starts below the ground is null, even where it comes out
    and goes under again: a camera under the relief must not pick a slope
    it sees from behind.
  - Pure apart from `three` and the library's `Ellipsoid` type; no DOM.
- Example:

  ```ts
  raycaster.setFromCamera(ndc, camera);
  const hit = groundHit(terrain, raycaster.ray);
  if (hit && (!itemHit || itemHit.distance > hit.t)) dragTo(hit.point);
  ```

- Tests: `globe-ground-hit.test.ts`: flat ground at eye height, a slope
  rising ahead, a tile seam (two tiles of different heights meeting), the
  sampled level changing between samples, unloaded stretches skipped and
  counted, null cases (up, underground, no heights, an underground start
  that re-enters further on), the group's world matrix, the maximum
  distance (and the Earth's curvature beyond it), `terrainAboveGround`
  directly, and the option refusals.
