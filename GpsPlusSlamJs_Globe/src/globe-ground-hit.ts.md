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
    than 3 rise per run, about 72 degrees; a least step of 1 m, growing by
    1 mm a metre of distance; a step of 2 % of the distance from a sample
    with no heights loaded; 24 halvings of the crossing's step).
  - `marchToGround(ray, aboveGround, options?)`: the first distance `t`
    where `aboveGround` goes from > 0 to <= 0 along the ray (normalised
    first), as a `GroundHitResult`: a hit
    `{ miss: null, t, point, samples, nulls }`, or a miss
    `{ miss, samples, nulls }` whose `GroundMissReason` says why, in this
    order:
    - `not-loaded`: any sample found no heights (or the start's were
      missing and the first loaded sample is underground); the ground may
      be there once they load, so the editor asks again (the only reason
      worth a retry);
    - `below-start`: the first loaded sample is on or under the ground;
    - `out-of-reach`: at `maxDistanceM` the ray was still closing on the
      ground (its last two loaded heights falling): a longer reach may
      find it;
    - `above`: any other ray that stayed over the ground: into the sky,
      level over the curved Earth, or past its closest approach.
    - Options: `startM`, `maxDistanceM`, `maxSlope` (> 0), `minStepM`,
      `stepPerM` (>= 0), `stepFraction`, `bisections` (1-60). RangeError
      for a zero or non-finite direction or an option out of range.
  - `terrainAboveGround(terrain)`: an `AboveGround` over a
    `createGlobeTerrain` result: a world point into the tiles' frame (the
    group's world matrix, read once when called), to latitude, longitude
    and height on the ellipsoid, minus the plugin's
    `sampleCartographicElevation`; null where no heights are loaded.
  - `groundHit(terrain, ray, options?)`: the two together, for a
    WORLD-space ray.
  - `groundReachM(heightM)`: a `maxDistanceM` for a camera `heightM` over
    the ground: to its horizon over a smooth Earth, sqrt(2 R h + h^2) with
    R 6 371 km, at least the default 5 km (a negative height, a camera
    under the ground, keeps the default): 30 m 19.6 km, 3 km 195.5 km.
    Ground that stands up beyond that horizon (a far mountain) is out of
    reach. RangeError for a non-finite height.
- What G2 (the editor's picking) uses:
  - a ray from `THREE.Raycaster.setFromCamera(ndc, camera)` (its `.ray`),
    passed to
    `groundHit(terrain, raycaster.ray, { maxDistanceM: groundReachM(heightOverGroundM) })`;
  - the miss reason: ask again on `not-loaded` only, leave the item
    where it is on any other;
  - on a hit, `nulls`: a hit whose march met missing heights may lie
    behind a ridge the march stepped over there (see the step bound), so
    the editor uses it for now and asks again once the heights load;
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
    grazes it, up to about 2 600 at the horizon (see what the bound costs,
    below).
- Invariants & assumptions:
  - The ground is what the plugin samples: the loaded tile's heights at
    its own level. Across a tile seam or a level change the sample is
    continuous enough that the bisection lands within the step it found
    (tested).
  - **The step bound.** From a sample at a height h over the ground, t
    along the ray, the next step is max(`minStepM`, `stepPerM` x t,
    h / sqrt(1 + `maxSlope`^2)). On ground no steeper than `maxSlope`
    nothing of the relief lies closer to that sample than the last term,
    so a step bounded by it never carries the march through a ridge and
    out again; only the least step can enter the ground, and then any
    underground stretch longer than the least step at its distance,
    max(`minStepM`, `stepPerM` x t), is found: 1 m up to 1 km out, 20 m
    at 20 km. This holds where every sample had heights loaded (`nulls`
    0). The hit is the
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
    so a ray that grazes the ground pays a sample per least step. With a
    fixed 1 m least step a ray aimed at the horizon, with the horizon's
    reach (`groundReachM`), grazed the curved Earth for all of it: from
    30 m 10 635 samples, from 300 m 12 067, from 3 km 12 511, and a level
    ray at eye height 5 001 over its 5 km. The least step's growth
    (`stepPerM`, about a pixel's footprint) bounds that. Swept over a
    smooth Earth of the mean radius, samples for a ray aimed at the
    horizon, with `stepPerM` 0 / 3e-4 / 1e-3 / 3e-3:
    - eye height (5 km reach): 5 001 / 4 687 / 2 612 / 1 239;
    - 30 m (19.6 km): 10 635 / 4 345 / 2 073 / 990;
    - 300 m (61.8 km): 12 067 / 2 670 / 1 357 / 703 (tested);
    - 3 km (195.5 km): 12 511 / 1 583 / 837 / 460.
    - Against the ridge property's draws (20 000 sampled, 12 330 valid,
      the 5 km reach): ridges whose stretch is shorter than the grown
      least step leave the guarantee, 12 / 124 / 287 of them at 3e-4 /
      1e-3 / 3e-3, of which the march actually stepped over 1 / 50 / 167;
      every ridge inside the guarantee was found at every value. 1e-3
      halves the eye-height cost and cuts the 300 m horizon ninefold for
      0.4 % of those ridges, each one the ray clips for less than a
      pixel's footprint; 3e-3 halves the cost again for three times the
      misses. What would reverse the choice: an editor that needs ground
      thinner than a pixel picked at range, which nothing asks for.
    - Before the bound the 2 % step took 284 for the level eye-height
      ray; at 0.1 degrees down the bound takes 1 022 (225), 0.5 degrees
      down 197 (144). A ray pointing at the ground is as cheap or cheaper
      than before: from 30 m 45 degrees down 39 (68), from 300 m 20
      degrees down 75 (220), from 3 km 45 degrees down 57 (300).
  - From a sample with no heights loaded nothing bounds the step, so it is
    max(`minStepM`, `stepPerM` x t, `stepFraction` x t), as before; a
    ridge inside or right after an unloaded stretch can be stepped over,
    so a hit with `nulls` > 0 may lie behind it.
  - A sample with no heights (null, or a non-finite value) is skipped and
    counted in `nulls`. The crossing is bracketed between the last loaded
    sample above the ground and the first loaded one at or below it, so a
    crossing inside an unloaded stretch is still found, within that
    stretch (the bisection stops at its first unloaded midpoint and
    returns the loaded end at or below the ground; G1 review L3: the
    first version needed two loaded samples in a row and missed it).
  - An unloaded start followed by a loaded sample at or below the ground
    is no hit, never a crossing: nothing says the ray was ever above it.
    Its reason is `not-loaded`, not `below-start`: the start's own height
    is unknown and may read above the ground once loaded.
  - The `out-of-reach` / `above` split reads the trend of the last two
    loaded heights, not the geometry: a ray still falling towards a far
    mountain past a dip reads by the dip. It tells the editor whether a
    longer reach is worth trying; it is not a proof either way.
  - **A shallow ray needs `maxDistanceM` raised.** From 3 km over the
    ground the default 5 km reach meets flat ground only below about 37
    degrees of pitch (asin(3/5)); a shallower overview pick is null. The
    editor passes `groundReachM` of its height over the ground (the lab's
    `groundHitAt` does).
  - A ray that starts below the ground has no hit, even where it comes out
    and goes under again: a camera under the relief must not pick a slope
    it sees from behind.
  - Pure apart from `three` and the library's `Ellipsoid` type; no DOM.
- Example:

  ```ts
  raycaster.setFromCamera(ndc, camera);
  const hit = groundHit(terrain, raycaster.ray, {
    maxDistanceM: groundReachM(cameraOverGroundM),
  });
  if (hit.miss === "not-loaded") retryNextFrame();
  else if (hit.miss === null && !(itemHit?.distance <= hit.t)) {
    dragTo(hit.point);
    // Met missing heights on the way: maybe behind a ridge not yet loaded.
    if (hit.nulls > 0) retryNextFrame();
  }
  ```

- Tests: `globe-ground-hit.property.test.ts`: random planes (the hit at
  the analytic distance; the miss `above` away from the plane and
  `out-of-reach` towards it past the reach), the ridge property of the
  step bound, and `groundReachM` growing with the height.
  `globe-ground-hit.test.ts`: the bank in front of a grazing ray, the
  bound's cost, the cost of a pick aimed at the horizon from 300 m (under
  1 500 samples, over 10 000 with the fixed least step), flat ground at
  eye height, a slope
  rising ahead, a tile seam (two tiles of different heights meeting), the
  sampled level changing between samples, unloaded stretches skipped and
  counted, a crossing inside an unloaded stretch found, each miss reason
  (up and level: `above`; underground and on the ground: `below-start`;
  no heights, missing heights along the way, an unloaded start whose first
  loaded sample is underground: `not-loaded`; short of the ground:
  `out-of-reach`), an underground start that re-enters further on, the
  group's world matrix, the maximum distance (and the Earth's curvature
  beyond it), `groundReachM` and the shallow overview pick it lets reach
  the ground, `terrainAboveGround` directly, and the option refusals.
