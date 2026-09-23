# atmosphere-lut-mapping.ts

## Purpose

The layout of the atmosphere's three look-up tables: texel ↔ physical
parameters, both directions. Every function has a GLSL twin in
`atmosphere-glsl.ts`; the LUT passes write with `…UvToParams`, the readers
use `…ParamsToUv`. Kept together and tested as round trips because a
mismatch does not error, it shifts or folds the sky.

## Public API

- Sizes: `TRANSMITTANCE_LUT_SIZE` 256×64, `MULTI_SCATTERING_LUT_SIZE`
  128×32, `SKY_VIEW_LUT_SIZE` 192×108.
- `texelToUnit(x, size)` / `unitToTexel(x, size)` — texel-centre remap, so
  the first and last texel centres are exactly 0 and 1.
- `transmittanceUvToParams(u, v)` / `transmittanceParamsToUv(r, mu)` —
  Bruneton 2017: `v = rho / H`, `u` interpolates the distance to the top
  between straight up (0) and grazing (1).
- `skyViewUvToParams(r, u, v)` / `skyViewParamsToUv(r, zenith, dAzimuth)` —
  Hillaire 2020 §5.3: the horizon is exactly `v = 0.5`, rows crowd toward it
  quadratically; `u²` crowds columns toward the sun.
- `multiScatteringUvToParams(u, v)` / `multiScatteringParamsToUv(mu, r)` —
  linear in sun cos-zenith (−1…1), QUADRATIC in altitude
  (`r = ground + v² · thickness`: half the rows in the lowest 25 km).

## Invariants & assumptions

- All mappings work in unit space; texel remapping is a separate step.
- The sky-view azimuth covers `[0, π]`: the sky is symmetric about the sun's
  vertical plane.
- **Multi-scattering width 128, not Hillaire's 32, by measurement**
  (2026-09-23): the look-dev parity check failed at blue hour, and a CPU
  replica of the LUT reproduced the GPU's numbers. Ψ falls steeply across
  the terminator; blue-hour sky error vs the exact model was ~150 % at 32
  columns, ~25 % at 64, ~2 % at 128. Daytime is within 1 % at all three.
  The cost lands only when visibility changes.
- **Multi-scattering rows quadratic in altitude, by measurement** (M3,
  2026-09-23): the parity sweep over all five presets found the hazy
  preset's near-horizon sky 12 % dark on the GPU. A CPU replica of the
  32-row LINEAR LUT reproduced the GPU to 0.1 %: rows 3.2 km apart cannot
  follow Ψ in the lowest kilometres, where haze lives. Quadratic rows at the
  same 32 give 0.3 %; 64 linear rows still gave 6 %. The GLSL mirrors both
  directions (`atmSampleMultiScattering`, the LUT fragment).

## Examples

```ts
const { u, v } = skyViewParamsToUv(r, Math.PI / 2, 0); // horizon toward the sun
const back = skyViewUvToParams(r, u, v); // same direction
```

## Tests

`atmosphere-lut-mapping.test.ts` — anchors (zenith, horizon, sun side) and
fast-check round trips for every mapping, the multi-scattering rows' ground
crowding. `atmosphere-scattering.test.ts` holds the measurement behind the
quadratic rows: a lazily built replica of the shipped 32-row LUT keeps the
near-horizon sky within 2 % of exact Ψ at 12 / 30 / 60 km visibility (linear
rows fail it at all three).
