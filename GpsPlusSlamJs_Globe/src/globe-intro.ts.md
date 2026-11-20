# globe-intro.ts - the globe's fly-in

- Purpose: round-5 plan 2026-10-01-0945 §3.1 (decisions DEC-GL5-1..3):
  the intro starts far out on the sun side and flies in to the user by
  distance alone; the field of view stays the page's throughout, so the
  camera is handed over without a jump and needs no ease back. Pure; directions are unit `[x, y, z]` (ECEF), distances
  km from the Earth's centre, angles degrees.
- Public API:
  - `GLOBE_INTRO`: `maxKm` 50,000 (the controls' limit and the intro's
    start), `turnCapDeg` 90, `lateFixBlendMs` 1500.
  - `introStartDirection(target, sun, capDeg)`: the target turned towards
    the sub-solar point along their great circle by min(cap, their angle).
    RangeError for a zero vector or a cap that is not a finite angle of 0
    or more.
  - `introCameraPose(t, { start, target, startKm, endKm })`:
    `{ direction, distanceKm }` at `t` (clamped to 0-1). The direction
    turns from start to target, eased; the distance falls from `startKm`
    to `endKm` evenly in the logarithm, eased. Exactly `(target, endKm)`
    at t = 1. RangeError for a non-finite `t` or distances that are not
    positive and finite.
  - `blendTarget(from, to, elapsedMs, blendMs)`: a late position becoming
    the target over `blendMs`, eased along the great circle; `to` once
    over (no jump in the intro's target).
  - `spinDirection(sun, elapsedMs, degPerS)` (review 2026-10-01-2124
    Major 2): where the intro spins while it waits, the sub-solar
    direction turned about the polar axis. RangeError for a zero sun or a
    time or rate that is not finite.
  - `flyInStart({ spin, target, sun, capDeg, sinceArrivalMs, blendMs })`:
    the fly-in's start, from the spin's direction to
    `introStartDirection(target, sun, capDeg)`, eased over `blendMs`
    (0: at once). Computed every frame from the target as it is then, so a
    position that replaces the target keeps the cap; this is what makes a
    GPS fix that arrives after the spin began start on the sun side too.
    RangeError for a negative or non-finite time or blend.
- Invariants & assumptions:
  - The ease is `t^2 (3 - 2t)`: zero slope at both ends, so the intro
    leaves and arrives without a jerk.
  - Opposite vectors (start and target 180 degrees apart) take the great
    circle through a fixed perpendicular, a choice rather than an error;
    equal ones give the start. "Parallel" is decided by the length of the
    target's part across the start (below 1e-9), not by the angle alone:
    the Globe gate on r764 found pairs 3e-16 apart whose perpendicular
    rounded to the zero vector and threw, which would have aborted the
    intro. Pinned in `globe-intro.test.ts`; the properties pass over 20
    seeds of 500 runs each (2 of 20 seeds failed before the fix).
  - Just past that cut-off (a start about 1e-7 short of opposite) the
    perpendicular is taken once more without its part along the start:
    the target's part across it is a difference of nearly equal numbers,
    and its rounding left the pose's direction about 5e-10 off unit
    length (a fast-check counterexample, pinned in `globe-intro.test.ts`).
  - Distances are from the centre, as the controls' limit is.
- Example:

  ```ts
  const start = introStartDirection(userDir, sunDir, GLOBE_INTRO.turnCapDeg);
  const pose = introCameraPose(elapsed / durationMs, {
    start,
    target: userDir,
    startKm: GLOBE_INTRO.maxKm,
    endKm: fitKm,
  });
  ```

- Tests: `globe-intro.test.ts` (the decisions, the start on the sun or at
  the cap, the ends, a monotone distance, the late-fix blend, refusals);
  `globe-intro.property.test.ts` (any target, sun and cap: the start's
  angle and its great circle; any moment: between start and end; any spin, target, sun and cap: the start begins at the spin
  and settles within the cap, written after the code).
  `spinDirection` and `flyInStart` are unit-tested in
  `globe-intro.test.ts` (seen red first).
