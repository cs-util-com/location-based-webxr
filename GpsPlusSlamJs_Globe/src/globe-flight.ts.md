# globe-flight.ts - the oblique flight's laws

- Purpose: round-5 plan 2026-10-01-0945 §3.5 and the one-scene plan
  2026-09-28-2140 §3.3-§3.4 (F1): the laws the dive follows on its way in,
  pure, so the lab and the dive read one source.
- Public API:
  - `GLOBE_FLIGHT`: `pitchHighM` 5,000 km and `pitchLowM` 1,000 km (the
    pitch law's band), `pitchLowDeg` 45 (the plan's default of its 30-60
    sweep), `exaggerationFarM` 2,000 km and `exaggerationNearM` 20 km (the
    exaggeration's band), `exaggerationNear` 1 (true heights at every altitude, the owner's D-K1,
    city plan 2026-10-05-0040 §11; it was 3, DEC-GL5-5),
    `exaggerationStep` 0.1, `groundBandTopM` 8 km and `groundBandBottomM` 2 km
    (the third band, K1), `clearanceM` 300, `radiusM` 6,371 km (the frame
    metric's sphere), `horizonMarginDeg` 5 (the least the view looks below
    the horizon).
  - `pitchAtDeg(altM, { pitchLowDeg? })`: the view's depression below the
    local horizontal: 90 above `pitchHighM` (looking at the centre,
    continuous with the intro's end), `pitchLowDeg` from `pitchLowM` down,
    smoothstep in the logarithm between; never less than
    `horizonMarginDeg` below the horizon, so the target (the view's centre)
    stays in view (review 2026-10-03-1835 minor 7: a low pitch of 30 looked
    past the horizon between about 985 and 1,300 km). RangeError for a
    non-finite altitude or a low pitch outside 0-90.
  - `exaggerationAt(altM, { near?, ground? })`: 1 above
    `exaggerationFarM`, `near` from `exaggerationNearM` down, smoothstep in
    the logarithm between, rounded to `exaggerationStep` (so the tile tree
    is not re-traversed every frame); never falls as the camera descends.
    2.2 at the 150 km hold with `near` 3. With `ground` (1 to `near`; city plan
    2026-10-05-0040 K1) a third band eases it from `near` at
    `groundBandTopM` to `ground` at `groundBandBottomM` and below,
    smoothstep in the logarithm, so a city can stand on true heights;
    there it falls as the camera descends, and never rises. RangeError for
    a negative altitude, a near value below 1 or a ground value outside 1
    to `near`.
  - `minimumAltitudeM(groundM, e, clearanceM)`: the least altitude over
    ground drawn at exaggeration `e`: max(ground, 0) x e + clearance (the
    sea drawn at 0, as the relief draws it). RangeError for e below 1 or a
    negative clearance.
  - `frameCheck({ altitudeM, pitchDeg, fovYDeg })`: the plan's metric:
    `targetVisible` when the view's centre (the target) looks below the
    horizon, `groundAtTop` when the top ray's depression (pitch - fov / 2)
    exceeds the horizon's dip acos(R / (R + h)); `dipDeg` too. At fovY 50 and 45
    degrees the horizon leaves the frame below about 409 km.
  - `carrierShareAt(altM, { highM?, lowM? })`: the relief carrier's share
    of the pixels in the altitude band (one-scene plan §3.2): 0 at and
    above `highM` (`GLOBE_FLIGHT.bandHighM`, 2,000 km; the globe's own
    surface alone), 1 at and below `lowM` (`bandLowM`, 1,200 km; the
    relief's tiles alone), smoothstep in the logarithm between; the
    globe's share is 1 minus it. RangeError for a non-finite altitude or
    edges not 0 < low < high. E leaves 1 (its first 0.1 step) near
    1,300 km, inside the band, so the relief is flat while the globe still
    draws. The band exists because the two carriers differ further out (at
    noon from 1,000 km by a mean 4.31 levels: the relief's library tiles
    are coarser over part of the frame).
  - The smoothstep is `globe-camera.ts`'s (one per package).
  - `clearedAltitudeM(altitudeM, displacedGroundM, clearanceM)`: the
    camera's altitude raised, if need be, to the clearance over the DRAWN
    ground under it (already exaggerated, the sea at 0); null ground (no
    relief loaded there) leaves it alone. The globe lab applies it every
    frame (review 2026-10-03-1835 major 1). RangeError for a non-finite
    altitude or ground, or a negative clearance.
- Invariants & assumptions: the bands are parameters, not verdicts; the
  pitch sweep (30, 45, 60) runs in the lab's relief smoke.
- Example:

  ```ts
  const e = exaggerationAt(150_000); // 2.2
  const pitch = pitchAtDeg(150_000); // 45
  const floor = minimumAltitudeM(4_800, e, GLOBE_FLIGHT.clearanceM);
  ```

- Tests: `globe-flight.test.ts` (the pitch law's ends, monotony and
  continuity; the exaggeration's ends, steps and monotony; the clearance;
  the third band's ends, its default (no change), its steps and its
  descent, and its refusals; the frame metric's 409 km edge and its hold at 150, 30 and 5 km for fov
  40-60; the band's exact edges, its midpoint and its monotony over three
  band placements). `globe-flight.property.test.ts`: with a ground value,
  E stays in 1 to near, is the ground value below the band and the default
  law above it, and never rises as the camera descends below 20 km. The dive's use is `globe-dive.test.ts`; the browser is
  `labs/globe/globe-relief.smoke.spec.mjs`.
