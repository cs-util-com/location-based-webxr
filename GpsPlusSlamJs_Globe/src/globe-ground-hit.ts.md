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
  - `GROUND_HIT`: the defaults (5 km reach; ground assumed no steeper
    than 3 rise per run, about 72 degrees; a least step of 1 m; a step of
    2 % of the distance from a sample with no heights loaded; 24 halvings
    of the crossing's step).
  - `marchToGround(ray, aboveGround, options?)`: the first distance `t`
    where `aboveGround` goes from > 0 to <= 0 along the ray (normalised
    first), as `{ t, point, samples, nulls }`; null when the ray stays
    above the ground within `maxDistanceM`, starts on or below it (its
    first LOADED sample is at or below the ground), or finds nothing
    loaded. Options: `startM`, `maxDistanceM`, `maxSlope` (> 0),
    `minStepM`, `stepFraction`, `bisections` (1-60). RangeError for a zero or
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
    cheap where the ray points at the ground (35 samples from eye height
    10 degrees down, 57 from 3 km 45 degrees down) and dearest where it
    grazes it (see the step bound below).
- Invariants & assumptions:
  - The ground is what the plugin samples: the loaded tile's heights at
    its own level. Across a tile seam or a level change the sample is
    continuous enough that the bisection lands within the step it found
    (tested).
  - **The step bound.** From a sample at a height h over the ground the
    next step is max(`minStepM`, h / sqrt(1 + `maxSlope`^2)). On ground no
    steeper than `maxSlope` nothing of the relief lies closer to that
    sample than this, so a step never carries the march through a ridge
    and out again; only a least step can enter the ground, and then any
    underground stretch longer than `minStepM` is found. The hit is the
    entry of the first underground stretch (property-tested over eye
    height to 3 km, pitches -89 to +10 degrees, ridges with flanks up to
    the assumed slope, pierced or passed over; 2 000 runs in the gate,
    20 000 checked once). The verdict rests on the slope: with flanks
    drawn up to 6 or 12 the property fails (shrunk to missed ridges at
    slopes 4.0 and 5.8), so ground steeper than `maxSlope` (cliffs in
    the finest relief) can still be stepped through from far above it.
    The march used to step 2 % of the distance, which jumped a 1.5 m bank
    109 m in front of an eye-height ray (tested).
  - **What the bound costs.** Near the ground the step is the least step,
    so a ray that grazes the ground pays a sample per metre: a level ray
    at eye height over level ground takes 5 001 samples to its 5 km reach
    (the 2 % step took 284), 0.1 degrees down 1 000 (225), 0.5 degrees
    down 220 (144). A ray pointing at the ground is as cheap or cheaper
    than before: from 30 m 45 degrees down 39 (68), from 300 m 20 degrees
    down 75 (220), from 3 km 45 degrees down 57 (300). A first-person
    editor that picks towards the horizon bounds its cost with
    `maxDistanceM`.
  - From a sample with no heights loaded nothing bounds the step, so it is
    max(`minStepM`, `stepFraction` x the distance), as before; a ridge
    inside or right after an unloaded stretch can be stepped over.
  - A sample with no heights (null, or a non-finite value) is skipped and
    counted in `nulls`. The crossing is bracketed between the last loaded
    sample above the ground and the first loaded one at or below it, so a
    crossing inside an unloaded stretch is still found, within that
    stretch (the bisection stops at its first unloaded midpoint and
    returns the loaded end at or below the ground; G1 review L3: the
    first version needed two loaded samples in a row and missed it).
  - An unloaded start followed by a loaded sample at or below the ground
    counts as underground (null), not as a crossing: nothing says the ray
    was ever above it.
  - **A shallow ray needs `maxDistanceM` raised.** From 3 km over the
    ground the default 5 km reach meets flat ground only below about 37
    degrees of pitch (asin(3/5)); a shallower overview pick is null. The
    editor passes a reach from its own height and pitch (or the far
    plane) for an overview.
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

- Tests: `globe-ground-hit.property.test.ts`: random planes (the hit at
  the analytic distance) and the ridge property of the step bound.
  `globe-ground-hit.test.ts`: the bank in front of a grazing ray, the
  bound's cost, flat ground at eye height, a slope
  rising ahead, a tile seam (two tiles of different heights meeting), the
  sampled level changing between samples, unloaded stretches skipped and
  counted, a crossing inside an unloaded stretch found, null cases (up,
  underground, no heights, an underground start that re-enters further
  on, an unloaded start whose first loaded sample is underground), the group's world matrix, the maximum
  distance (and the Earth's curvature beyond it), `terrainAboveGround`
  directly, and the option refusals.
