# water-candidates.js - the pond's chosen wave set

- Purpose: the look-dev pond's replacement wave sets (programme plan
  2026-09-26-0539, W6 plan §5). The owner saw today's six waves repeat as a
  symmetric, running pattern; candidates were chosen by a measured
  repetition metric and judged on a phone. P50 was chosen; the others
  (C1, P30, D30) were dropped and remain in git history.
- Public API: `WATER_CANDIDATES`: an array of `{ id, label, peaks, alu,
slopeGlsl }`.
  - `id`: `P50` (`C0`, the six built-in waves, needs no GLSL).
  - `peaks`: the repetition metric (the highest autocorrelation peak of the
    slope field; 1 = an exact repeat), the median over 8 window positions,
    at pixel footprints 0 / 1 / 2.5 / 4 m. Today's six waves read
    0.97 / 0.98 / 1.00 / 1.00.
  - `alu`: a hand-counted estimate per water pixel (today's: 126). It is not
    a frame time; the phone frame time is still unmeasured.
  - `slopeGlsl`: a GLSL `waterSlopeAt(vec2 p, float t)` for
    `new WaterSurface({ slopeGlsl })` (framework
    `water-surface-material.ts`), with its warp (an integer hash, WebGL2
    `uint`) and the wave-group envelope ("wind patches") inline.
- Invariants & assumptions:
  - GENERATED from the W6 exploration (seeded wave sets, the shader's exact
    anti-alias fade, a bit-exact JS twin of the hash, checked on a GPU): do
    not edit by hand. The generator and its tests live in the exploration
    folder recorded in the W6 plan §5.
  - Every entry defines `waterSlopeAt`; `WaterSurface` refuses GLSL that
    does not.
  - The metric was measured on a top-down field. W1 lifted the pond, which
    changes the city-view distances, so the far-field numbers are to be
    re-measured before another set replaces P50.
- Examples: `new WaterSurface({ slopeGlsl: WATER_CANDIDATES[0].slopeGlsl })`.
- Tests: `lookdev.smoke.spec.mjs` (removed; in git history), "the water candidates compile, change the
  pond, and travel in the address": each compiles without console errors,
  changes at least 4 of 12 pond points against today's waves (measured
  2026-09-26: C1 9, P50 12, P30 11, D30 12), and keeps moving.
