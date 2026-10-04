# parity.js — GPU/CPU parity for the atmosphere's LUTs

- Purpose: read a few texels back from each GPU look-up table and compare
  them with the framework's CPU twin of the same computation. The only
  check that the GLSL computes what the tested TypeScript computes (plan
  review finding 9).
- Public API: `lutParity(atmosphere, { sunCosZenith })` →
  `{ transmittance, multiScattering, skyView, samples }`, the worst relative
  error per LUT plus every sample (`lut, x, y, gpu, cpu, error`).
- Invariants & assumptions:
  - Relative error with a floor, so a texel whose true value is ~0 does not
    turn a harmless absolute error into infinity.
  - Non-zero tolerance by design: half-float storage (~0.1 %) and bilinear
    reads of the transmittance and Ψ LUTs on the GPU vs. exact values on the
    CPU.
  - Samples avoid LUT edges; sky-view samples include one below the horizon.
  - The CPU side of the sky-view samples runs the full multi-scattering
    integral per step (a few million evaluations): slow, test-only.
- History: the first run found a 176 % blue-hour error. A CPU replica of the
  32-column multi-scattering LUT reproduced it, and the width became 128
  (see `atmosphere-lut-mapping.ts.md`).
- `skyPixelExpected(atmosphere, { direction, sunDirection })` → the 8-bit
  sRGB colour the sky pass should draw in `direction` (CPU sky radiance × the
  scene scale, no tone mapping): the only check of the sky pass's LOOKUP
  path, scale and colour space. Measured: within 2 levels at noon and golden
  hour.
- Tests: called by `lookdev.smoke.spec.mjs` at noon, golden hour and blue
  hour with a 5 % bound; `shoot-3d.mjs --parity` prints the details.
