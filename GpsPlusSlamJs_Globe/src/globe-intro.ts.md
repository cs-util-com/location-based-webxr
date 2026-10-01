# globe-intro.ts - the globe's fly-in

- Purpose: round-5 plan 2026-10-01-0945 §3.1 (owner decisions DEC-GL5-1..3):
  the intro starts far out on the sun side and flies in to the user, in
  one of four ways of trading distance against field of view, all ending
  at one pose and field of view so the lab can hand the camera over
  without a jump. Pure; directions are unit `[x, y, z]` (ECEF), distances
  km from the Earth's centre, angles degrees.
- Public API:
  - `GLOBE_INTRO`: `maxKm` 50,000 (DEC-GL5-1, the controls' new limit and
    the intro's start), `endFovDeg` 50 (DEC-GL5-2), `turnCapDeg` 90
    (DEC-GL5-3), `wideFovDeg` 80 (where `narrow` and `fov` start),
    `dollyStartFovDeg` 50, `fovPhase` 0.6 (the share of `fov` spent
    narrowing far out), `lateFixBlendMs` 1500.
  - `INTRO_VARIANTS`: `distance`, `narrow`, `fov`, `dolly` (the lab's
    `intro=`).
  - `introStartDirection(target, sun, capDeg)`: the target turned towards
    the sub-solar point along their great circle by min(cap, their angle).
    RangeError for a zero vector or a cap that is not a finite angle of 0
    or more.
  - `introCameraPose(t, { variant, start, target, startKm, endKm,
endFovDeg })`: `{ direction, distanceKm, fovDeg }` at `t` (clamped to
    0-1). The direction turns from start to target, eased, in every
    variant; `distance` falls from `startKm` to `endKm` evenly in the
    logarithm, eased, at the end's field of view; `narrow` the same while
    the field of view narrows from 80; `fov` holds `startKm` while the
    field of view narrows from 80 over `fovPhase`, then flies in; `dolly`
    flies while it widens from 50 (with an end of 50 it is `distance`).
    Exactly `(target, endKm, endFovDeg)` at t = 1. RangeError for an
    unknown variant, a non-finite `t`, distances that are not positive and
    finite, or a field of view outside (0, 180).
  - `blendTarget(from, to, elapsedMs, blendMs)`: a late position becoming
    the target over `blendMs`, eased along the great circle; `to` once
    over (no jump in the intro's target).
- Invariants & assumptions:
  - The ease is `t^2 (3 - 2t)`: zero slope at both ends, so the intro
    leaves and arrives without a jerk.
  - Opposite vectors (start and target 180 degrees apart) take the great
    circle through a fixed perpendicular, a choice rather than an error.
  - Distances are from the centre, as the controls' limit is.
- Example:

  ```ts
  const start = introStartDirection(userDir, sunDir, GLOBE_INTRO.turnCapDeg);
  const pose = introCameraPose(elapsed / durationMs, {
    variant: "narrow",
    start,
    target: userDir,
    startKm: GLOBE_INTRO.maxKm,
    endKm: fitKm,
    endFovDeg: GLOBE_INTRO.endFovDeg,
  });
  ```

- Tests: `globe-intro.test.ts` (the decisions, the start on the sun or at
  the cap, every variant's ends, each variant's own field of view, monotone
  distance and field of view, the late-fix blend, refusals);
  `globe-intro.property.test.ts` (any target, sun and cap: the start's
  angle and its great circle; any moment of any variant: between start
  and end).
