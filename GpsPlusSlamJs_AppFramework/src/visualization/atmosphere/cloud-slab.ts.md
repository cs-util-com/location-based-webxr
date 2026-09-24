# cloud-slab.ts

## Purpose

The cloud SLAB (plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-1010-lookdev-fly-through-cloud-layer-plan.md`
§11, amended by the review triage §12): the dome layer's clouds as a thin
volume between 1.8 and 2.2 km, ray-marched per pixel, a third `cloudMode`
to A/B against the sheet on the look-dev page. The noise sets each column's
thickness, so the cover keeps meaning share of sky from the zenith, and a
camera inside the layer sees a whiteout instead of the sheet's dissolve.

This file holds the constants, the CPU twin of everything the shader
computes, the shader and the mesh. `SkyAtmosphere` owns the mesh and adds
it only in `cloudMode: 'slab'`.

## Public API

- `CLOUD_SLAB`: base 1800 m, top 2200 m, radius (the sheet's 24 km),
  extinction σ 0.02/m, base ramp b 50 m, height scale H 1000 m per noise
  unit, the sun's path factor k 0.25 and elevation floor 0.1, `maxMarchM`
  22 km, the early-exit transmittance 0.01, the level-ray limit, and
  `defaultSteps` 16.
- `CLOUD_SLAB_STEPS`: the step counts the shader is built for, 8/16/24/32.
- `cloudSlabCumulativeM(h, b?)`: Q(h), the integral of the base ramp
  clamp(x/b, 0, 1) from 0 to h.
- `cloudSlabThresholdThicknessM(σ?, b?)`: T0 = Q⁻¹(ln 2/σ), the column
  thickness whose zenith opacity is one half; defined for any ramp.
- `cloudSlabThicknessM(noise, threshold)`: T0 + H·(noise - threshold),
  clamped to [0, 400 m]; 0 for an infinite threshold (cover 0).
- `cloudSlabZenithOpacity(noise, threshold)`: 1 - e^(-σ·Q(T)).
- `cloudSlabInterval(y, dir)`: the analytic part of the ray inside the slab
  and the far fade, `{ inM, outM }` or null. Throws `RangeError` for a
  non-finite height or a zero or non-finite direction.
- `cloudSlabSteps(n, L, jitter = 0.5)`: quadratic step starts, ends and
  samples over [0, L], each sample `jitter` of the way through its step.
  Throws `RangeError` for a step count outside `CLOUD_SLAB_STEPS`, a bad
  length or a jitter outside [0, 1].
- `cloudSlabStepOpticalDepth(y, dirY, t0, t1, T)`: the step's optical
  depth, integrated exactly in height (σ·|ΔQ|/|dirY|); nearly level rays
  sample the step's middle.
- `cloudSlabSunTransmittance(h, T, sunY)`: the sun reaching height h of a
  column through the column above it; at most 1.
- `cloudSlabSourceRadiance(sunT, cosToSun, density, zenith, sunY, reach)`:
  the sheet's top radiance at reach 1, the dome's underside at reach 0,
  mixed linearly.
- `cloudSlabLod(t, pixelAngle, step, dirHorizontal)`: the noise's level
  of detail from the pixel footprint or the step's horizontal skip.
- `cloudSlabRenderOrder(y)`: -1 at or below the base, +1 inside and above.
- `cloudSlabFarWeight(horizontalM)`: the sheet's far fade, as a weight.
- `cloudSlabMarch(input)`: the shader's march on the CPU, returning the
  weighted `alpha`, the unweighted `opacity`, the premultiplied `colour`
  (with `light`) and `stepsTaken`.
- `CLOUD_SLAB_FRAGMENT_GLSL`: the march (the vertex shader is
  module-private and only covers the pixels).
- `createCloudSlab(uniforms, steps = 16)`: the mesh, reading the given
  uniform objects (the sky's LUTs, sun, scale and cloud uniforms) plus its
  own ray uniforms, which `onBeforeRender` sets from the rendering camera
  and viewport.
- `setCloudSlabSteps(slab, steps)`: the step count, as a define (a new
  program); `RangeError` before any change for a count it is not built for.
- Types: `Vec3`, `CloudSlabSteps`, `CloudSlabMarchInput` (its `light` is
  `{ sunTransmittance, sunDir, zenith }`),
  `CloudSlabMarchResult`.

## Invariants & assumptions

- **The view ray comes from the pixel** (`gl_FragCoord`, the inverse
  projection, the camera's world matrix and the viewport of the current
  render), never from the mesh's interpolated position: M1 measured 24 km
  triangles breaking with the eye 0.5 m away. The mesh only has to cover the
  right pixels: a prism of the sheet's ring disc as caps (top facing up,
  bottom facing down) and a 48-segment wall, every face outward, drawn
  `BackSide` so the far inside shows from below, inside and above.
- **Occlusion without a depth texture:** the scene never reaches the base,
  so the depth test against the back faces is enough (as for the sheet).
- **Draw order:** -1 from below, +1 from inside and above, one frame late
  (as for the sheet).
- **A static per-pixel jitter** (interleaved gradient noise) moves each
  step's sample point, not its bounds. A fixed sample point drew the far
  deck as terraced bands at level rays, where one step spans kilometres of
  ground, at 16 steps and still at 32 (seen on the look-dev page, plan
  §12.1). The jitter trades the bands for a fine grain, since the page has
  no temporal accumulation.
- **Cost:** 16 steps make 32 noise reads per pixel plus the hoisted light
  (3 sky-view and 3 transmittance reads: `atmCloudLit` twice and
  `atmCloudTopLit` once, each one of each; the two `atmCloudLit` calls read
  the same texels). On SwiftShader at 1280×800 a slab
  frame took 0.66 s (the smoke's log); the real cost is the owner's GPU.

- **Cover means share of sky, from the zenith.** σ·Q(T0) = ln 2, so a
  column at the threshold is half opaque straight up and opacity rises with
  the noise; the share of columns above one half is the cover. Off zenith
  the path grows as 1/sin(e), so a low view reads cloudier than the sheet
  at the same cover (plan §12 item 4; physically right).
- **The step count does not change a vertical ray's opacity**, because each
  step's optical depth is the exact height integral of its column. The
  drawn alpha carries the far and aerial weights, per sample, so it does
  (slightly).
- **The weights go on the contribution, not on the extinction**, so the far
  fade reaches 0 for any thickness.
- **2.5D, not 3D:** a 2D noise field times a vertical profile. Flat bases,
  tops rising with the noise, a flat deck at the top at high cover (5.7 %
  of cloud columns at cover 0.5, 33 % at 0.9, measured).
- **The light is the sheet's model with depth**, with no branch on the view
  direction. Toward the sun the forward lobe makes undersides brighter than
  tops (measured 0.81 against 0.51 at noon), so "tops are brighter" holds
  AWAY from the sun only.
- **The CPU twin cannot reproduce GL mips**, which are
  implementation-defined; its sampler takes the level of detail and may
  ignore it.

## Example

```ts
const m = cloudSlabMarch({
  camera: [0, 18, 0],
  dir: [0, 1, 0],
  steps: 16,
  sample: (x, z) => noiseAt(x, z),
  threshold: cloudThreshold(0.5),
});
m.opacity; // the column's opacity straight up
```

## Tests

- `cloud-slab.test.ts`: the constants' relations; Q's continuity; T0 at
  ln 2 for any ramp; the column's half opacity, monotonicity and reach; the
  cover as the share of opaque zenith columns on the shipped noise (± 0.05
  at 0.2/0.5/0.8); the edge slope against the dome's; the flat-top share;
  the interval's cases; the quadratic steps; the exact step integral
  against a brute-force one; the light's two ends and its cap at 1; the
  march's vertical opacity at every N, early exit, cover 0, 8 against 32
  steps over seeded rays, and tops against undersides away from the sun
  (measured over k); the level of detail; the draw order and far weight.
- `cloud-slab.property.test.ts`: every point the interval allows lies in
  the slab and in the far fade, for any camera and direction; the steps
  tile any interval.
- `cloud-slab.test.ts` also covers the shader's text (the shared chunks,
  every constant, explicit-level reads and no LUT reads inside the loop,
  the ray from `gl_FragCoord`, the jitter as the sample point only), the
  prism's outward faces, the material, the camera hook's uniforms and
  order, and the step-count setter; `sky-atmosphere.test.ts` the mode
  wiring; `atmosphere-glsl.test.ts` `atmCloudNoiseLod`; the look-dev
  smoke that the shader compiles and covers the city from above.
- Mutants checked: midpoint sampling for every ray fails the exact-integral
  and vertical-opacity tests; the sun measured from the base fails the
  light test.
