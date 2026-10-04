# atmosphere-scattering.ts

## Purpose

The CPU twin of the scattering passes: phase functions, the medium at an
altitude, one multi-scattering LUT texel (Hillaire 2020 §5.5) and one sky
radiance (the sky-view LUT's content, §5.3). Not used for rendering: it is
where the physics is tested, and the oracle the look-dev page's parity
readback compares the GPU LUTs against.

## Public API

- `rayleighPhase(cosθ)`, `miePhase(cosθ, g)` (Cornette-Shanks) — both
  normalised over the sphere.
- The medium itself (`mediumAt`) lives in `atmosphere-model.ts`, shared
  with the optical-depth integral.
- `multiScattering(r, sunCosZenith, params, sqrtDirections = 8, steps = 20)`
  → `{ fms, psi }`, with Ψ = L2 / (1 − f_ms).
- `skyRadiance(r, viewZenith, dAzimuth, sunCosZenith, params, psi, steps = 32)`
  → radiance for a sun of illuminance 1. `psi` is a lookup (the caller
  decides exact vs. tabulated).
- `PsiLookup` type.

## Invariants & assumptions

- Radiance is for a unit sun; the GPU stores it ×`ATMOSPHERE_RADIANCE_SCALE`.
- Sun transmittance is computed EXACTLY here; the GPU reads its LUT. A spike
  on 2026-09-23 showed bilinear (and log-space) transmittance lookup matches
  the exact value to three digits at noon, golden hour and blue hour, so that
  difference is negligible. The difference that mattered was Ψ's LUT
  resolution (see `atmosphere-lut-mapping.ts.md`).
- Steps: quadratic placement for BOTH integrals. Multi-scattering first used
  Hillaire's uniform steps; a sweep showed they miss the 1.2 km Mie layer on
  ~1 100 km near-horizontal rays (up to 42 % off in haze).
- Sampling counts (shared with the GLSL via `EARTH_ATMOSPHERE`), each held by
  a test to its 2026-09-23 sweep verdict: sky view 32 steps (≤ 1.3 % of 512
  over visibility 20/80 × sun 30/5/−4 × zenith 0…89.5°); multi-scattering
  16×16 directions × 20 steps (ground-level sky ≤ 2 % of a 64×64 oracle over
  visibility 20/80 × sun −6/−4/5 × zenith 0/60/85; 8×8 was 11.6 %).
- Below the horizon the march stops at the ground and adds the lit ground
  (albedo / π).

## Examples

```ts
const psi = (r, mu) => multiScattering(r, mu, params).psi;
const radiance = skyRadiance(r, 1.2, 0.3, Math.sin(0.1), params, psi);
```

## Tests

`atmosphere-scattering.test.ts` — phase normalisation, forward Mie, blue
zenith, warm sunset horizon, the Mie glow asymmetry, darkness far below the
horizon, finite ground radiance, f_ms in (0, 1), and the multi-scattering
share measured by a sweep (+23…80 % by day, 6–40× at −9°).
