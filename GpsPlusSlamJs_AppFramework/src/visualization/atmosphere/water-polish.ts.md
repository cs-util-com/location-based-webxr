# water-polish.ts

## Purpose

The water polish (round-3 plan
`GpsPlusSlamJs_Docs/docs/2026-09-27-0532-owner-feedback-round-3-plan.md`,
stream W; DEC-FB3-9): six cheap shading tricks ON TOP of a wave set, each
behind its own switch, so each can be judged alone against the unpolished
water. `WaterSurface` (`water-surface-material.ts`) takes the switches as
`new WaterSurface({ polish })`.

1. `lostVariance`: the slope variance of the waves the anti-aliasing fade
   removed, Σ (1 − fade²)·(A·k)²/2, is added to the specular α² (three:
   α = roughness²). Water whose waves a pixel no longer resolves becomes a
   soft sheen instead of glitter.
2. `sunSize`: the sun's angular radius (0.2666°) is folded into α² of the
   DIRECT light only, α² + (scale × radius)², so no highlight is narrower
   than the sun's disc.
3. `fresnelDamp`: the environment reflection is divided by (1 + c·α²).
4. `antiTiling`: waves with k ≥ `tileMinK` are sampled a second time, the
   direction rotated by `tileRotationRad`, k scaled by `tileScale` and ω by
   √`tileScale` (deep-water dispersion), and the two samples blended by a
   value-noise mask of cell `tileMaskM`, with weights whose squares sum
   to 1 (`waterTileBlend`): weights summing to 1 lost the ripples'
   variance where the mask was half-way, which read as calmer water
   (measured on the GPU, 2026-09-28).
5. `gusts`: a value-noise field of cell `gustScaleM`, travelling downwind at
   `gustSpeedMps`, scales the slopes of waves with k ≥ `gustMinK` by
   max(0, 1 + `gustDepth` × noise).
6. `body`: the water body is lit by the flat surface's irradiance (the sun
   by its elevation, the sky from the environment's irradiance for "up"),
   times the tint (three's diffuse colour), times the share of light the
   surface lets out (1 − Schlick Fresnel of the wave normal), instead of
   Lambert on the wave normal; plus light through backlit crests:
   `crestStrength` × sun × (view toward the sun)^`crestPower` × (the face's
   tilt toward the viewer / `crestSlope`, clamped) × a fixed green-blue.

## Public API

- `WATER_POLISH_SWITCHES`: the six names in canonical order (the program
  key's order).
- `WATER_POLISH`: every constant's default (picked by the stream-W
  sweeps, logged in the record `2026-09-28-1936-water-polish-results.md`
  in `GpsPlusSlamJs_Docs/docs/`). Swept ones become uniforms;
  `sunAngularRadiusRad`, `tilePhaseRad`, `tileMaskEdges`, `gustWind` and
  `crestColor` are FIXED (compiled in).
- `normalizeWaterPolish(flags?)` → every switch named, frozen; RangeError
  for an unknown switch, a non-boolean value, or a non-object.
- TS twins: `waterLostVariance(waves, footprintM)`,
  `waterVarianceRoughness(r, variance, scale?)`,
  `waterSunRoughness(r, scale?, radiusRad?)`,
  `waterFresnelDampFactor(r, c?)`, `waterGustGain(noise, depth?)`,
  `waterTileWave(direction, k, omega, rotationRad?, scale?)`,
  `waterTileBlend(mask)`. The wave sets' fade ([0.8, 1.6] rad) is a module
  constant (`WATER_POLISH_FADE_RAD`), not exported.
- `WATER_POLISH_DEFAULT_PARAMS`: the swept constants at their defaults (a
  sweep's "back to default").
- `createWaterPolishUniforms()`, `configureWaterPolishUniforms(uniforms,
values)`: the uniforms at the defaults; a partial update that validates
  the whole set first (RangeError for `values` that is not an object, an
  unknown name, a non-finite value or one outside its range, and then
  nothing changes).
- `buildWaterPolish(flags?)` → `{ active, declarations, slope(glsl),
beforeSlope, afterMaterial, afterLightingPars }`: the GLSL each anchor
  gains; all empty and `slope` the identity when no switch is on.

## Invariants & assumptions

- **Every switch is compiled in or out**, never a branch on a uniform, so
  all-off is exactly the unpolished water: same source, key and uniforms
  (pinned by `water-surface-material.test.ts` against the water before the
  polish existed).
- **The per-wave hook** (1, 4, 5) needs the wave set's one
  `void waterWave(vec2 <pos>, float t, vec2 d, float k, float ak, float w,
float phase, inout vec2 slope)` with one statement
  `slope += fade * ak * cos(<arg>) * d;` (the built-in waves and every
  generated candidate have it). The statement becomes
  `waterPolishWave(<pos>, t, d, k, ak, w, phase, fade, <arg>, slope);`, so
  the wave's own term keeps its expression. `slope()` throws a RangeError
  for a wave set without it; the lighting tricks need no hook.
- **The lighting wrappers copy no chunk text**: after
  `#include <lights_physical_pars_fragment>` they `#undef` and redefine
  `RE_Direct` and `RE_IndirectSpecular` to functions that call three's own
  `RE_Direct_Physical` / `RE_IndirectSpecular_Physical` with a modified
  copy of the material (a widened roughness, or a black diffuse), then add
  their own terms. They compose with the cloud shadows (which wrap
  `getDirectionalLightInfo`) and the haze.
- The tile branch (`k >= uWaterPolishTileMinK`) is uniform across a pixel
  quad (k is a per-call constant), so `fwidth` inside it is defined.
- **`body` wraps only the direct light and the environment term.** Three's
  indirect diffuse (`RE_IndirectDiffuse`: the ambient light, light probes
  and hemisphere lights) still lights the body on the WAVE normal, with the
  full tint and no (1 − Fresnel) weight. And the body's sky term reads the
  IBL irradiance three hands `RE_IndirectSpecular`, which is zero without an
  environment map, so with no `scene.environment` the body gets no sky
  light at all. The look-dev page has no ambient light, probe or hemisphere
  light and always has an environment, so neither shows there; wrapping
  `RE_IndirectDiffuse` waits for a caller that has such a light.
- The noise is an integer-hash value noise (WebGL2 `uint`), no texture.
- `fresnelDamp` changes little on calm water because α² = r⁴ is small: on
  P50 it is a few thousandths even over `lostVariance`'s roughness, so
  1/(1 + 6 α²) stays within a few per cent of 1 at the roughest pixel and
  the far water's mean moves by well under 1 % (lake view at golden hour,
  medians over three wave times: c = 3/6/12/50 give -0.1/-0.3/-0.6/-2.2 %;
  only c = 50 is plainly visible). That is the formula, not three's split-sum
  environment term: the first cut named that as the reason, and the
  milestone review corrected it. The look-dev smoke gates that the far
  mean falls monotonically in c, visibly at c = 50, so a broken damp fails.

## Examples

```ts
const water = new WaterSurface({
  slopeGlsl: P50,
  polish: { lostVariance: true, sunSize: true },
});
water.configurePolish({ varianceScale: 0.5 }); // no recompile
```

## Tests

- `water-polish.test.ts`: the switches' validation, the twins' values, the
  uniforms' defaults and all-or-nothing validation, each switch's GLSL
  touching only its own hooks, the hook keeping the wave's own argument,
  the refusal of an unhookable wave set.
- `water-polish.property.test.ts`: lost variance monotone in the footprint
  and bounded by the waves' total; roughness never lowered and never above
  1; the damp never brightens; the gust gain averages 1; the second sample
  stays a unit direction on the dispersion curve.
- `water-surface-material.test.ts`: the pins, the all-off equality, each
  switch on the real ShaderLib shader with its own program key.
- GPU: `GpsPlusSlamJs_DesignSystem/3d/water-polish.smoke.spec.mjs`
  (each trick against the unpolished water at the same pixels).
