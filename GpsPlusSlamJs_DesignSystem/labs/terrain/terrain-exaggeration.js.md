# terrain-exaggeration.js: exaggeration, view width, slope boost

- Purpose: the terrain lab's vertical exaggeration E and the shading's slope
  boost (terrain plan 2026-09-27-0605 DEC-TR-4, §6, §9 findings 9, 10, 19).
- Public API:
  - `EXAGGERATION` `{ min: 1, max: 10, fallback: 3 }`: the slider (3, the
    owner's look value since globe round-5 DEC-GL5-5; 2 before).
  - `AUTO_RULE` `{ refWidthM: 10 km, exponent: 0.3, cap: 3 }` and
    `autoFactor(widthM, rule?)` = clamp((W / ref)^exponent, 1, cap).
  - `SLOPE_BOOST` `{ refWidthM: 5 km, exponent: 0.3, cap: 5 }` and
    `slopeBoost(widthM, rule?)`: 3.2x at 250 km.
  - `VIEW_WIDTH_PER_ALTITUDE` 0.43 and `viewWidthM(altitudeM)`: W for the
    reference view (portrait, 50° vertical field of view); never negative.
  - `effectiveExaggeration({ slider, auto, altitudeM, rule? })`: the slider
    (clamped to 1-10, a non-number reads as 2), times the auto factor when
    auto is on.
  - `smoothAltitude(currentM, targetM, dtS, tauS)`: one step of exponential
    smoothing in LOG altitude; never overshoots; tau 0 jumps.
- Invariants & assumptions:
  - Auto is a switch, OFF by default: by default E is the slider, 2x.
  - The factor is capped, the product is not: slider 2 at 250 km is 5.3x.
  - Auto reads a smoothed altitude (Mapbox saw flicker otherwise); the time
    constant is a hash parameter (`tau`), for the owner to sweep.
  - E never enters the shading normal; the boost is the shading's own gain.
- Example: `effectiveExaggeration({ slider: 2, auto: true, altitudeM: 580e3 })`
  is about 5.25.
- Tests: `terrain-exaggeration.test.mjs`: the slider's range, W, the plan's
  factors at 5/10/20/250 km, the cap, the exponent sweep 0.2/0.3/0.5, a
  monotonic factor, E with auto off at every altitude, the uncapped
  product, the slider's clamping, the smoothing's time constant, jump and
  no overshoot over tau 0.1-2 s, and the boost at 250 km with exponents
  0.2/0.3/0.4.
