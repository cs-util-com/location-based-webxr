# globe-flight.ts - the oblique flight's laws

- Purpose: round-5 plan 2026-10-01-0945 §3.5 and the one-scene plan
  2026-09-28-2140 §3.3-§3.4 (F1): the laws the dive follows on its way in,
  pure, so the lab and the dive read one source.
- Public API:
  - `GLOBE_FLIGHT`: `pitchHighM` 5,000 km and `pitchLowM` 1,000 km (the
    pitch law's band), `pitchLowDeg` 45 (the plan's default of its 30-60
    sweep), `exaggerationFarM` 2,000 km and `exaggerationNearM` 20 km (the
    exaggeration's band), `exaggerationNear` 3 (DEC-GL5-5),
    `exaggerationStep` 0.1, `clearanceM` 300, `radiusM` 6,371 km (the frame
    metric's sphere).
  - `pitchAtDeg(altM, { pitchLowDeg? })`: the view's depression below the
    local horizontal: 90 above `pitchHighM` (looking at the centre,
    continuous with the intro's end), `pitchLowDeg` from `pitchLowM` down,
    smoothstep in the logarithm between. RangeError for a non-finite
    altitude or a low pitch outside 0-90.
  - `exaggerationAt(altM, { near? })`: 1 above `exaggerationFarM`, `near`
    from `exaggerationNearM` down, smoothstep in the logarithm between,
    rounded to `exaggerationStep` (so the tile tree is not re-traversed
    every frame); never falls as the camera descends. 2.2 at the 150 km
    hold. RangeError for a negative altitude or a near value below 1.
  - `minimumAltitudeM(groundM, e, clearanceM)`: the least altitude over
    ground drawn at exaggeration `e`: max(ground, 0) x e + clearance (the
    sea drawn at 0, as the relief draws it). RangeError for e below 1 or a
    negative clearance.
  - `frameCheck({ altitudeM, pitchDeg, fovYDeg })`: the plan's metric: the
    target at the view's centre (in the centre third by construction) and
    `groundAtTop` when the top ray's depression (pitch - fov / 2) exceeds
    the horizon's dip acos(R / (R + h)); `dipDeg` too. At fovY 50 and 45
    degrees the horizon leaves the frame below about 409 km.
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
  the frame metric's 409 km edge and its hold at 150, 30 and 5 km for fov
  40-60). The dive's use is `globe-dive.test.ts`; the browser is
  `labs/globe/globe-relief.smoke.spec.mjs`.
