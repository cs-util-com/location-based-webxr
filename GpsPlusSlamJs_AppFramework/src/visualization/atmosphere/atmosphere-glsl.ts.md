# atmosphere-glsl.ts

## Purpose

The atmosphere's GLSL, generated from the TypeScript model: the shared
chunk (constants, geometry, medium, phases, LUT mappings), the three LUT
fragment shaders, and the visible sky's vertex/fragment pair.

## Public API

- `ATMOSPHERE_COMMON_GLSL` — needs uniform `atmMieExtinction`.
- `ATMOSPHERE_LUT_VERTEX_GLSL` — full-screen triangle.
- `TRANSMITTANCE_LUT_FRAGMENT_GLSL`, `MULTI_SCATTERING_LUT_FRAGMENT_GLSL`,
  `SKY_VIEW_LUT_FRAGMENT_GLSL`.
- `SKY_VERTEX_GLSL`, `SKY_FRAGMENT_GLSL` — camera-centred at the far plane,
  sky-view LUT + analytic limb-darkened sun disc, three's tone mapping and
  output colour space.
- `ATMOSPHERE_RADIANCE_SCALE` (1000); `ATMOSPHERE_MAX_SCENE_RADIANCE`
  (60 000), the most the visible sky ever writes (below the largest finite
  half float; see Invariants). Float literals come from the
  package's `utils/glsl-float.ts`; step counts from `EARTH_ATMOSPHERE`.
- `ATMOSPHERE_CLOUD_GLSL`: the cloud chunk (uniforms, `CLOUD_LAYER`
  constants, `atmCloudDensity`, `atmCloudHorizonFade`, `atmCloudNoise`,
  `atmCloudNoiseLod`, `atmCloudLit`), shared by the sky dome, the
  fly-through sheet (`cloud-sheet.ts`) and the slab (`cloud-slab.ts`), so
  all three draw one pattern, cover and light. With the uniform
  `atmCloudHex` at 1 both reads take the first octave hex-tiled
  (`CLOUD_HEX_GLSL`, included here; hex-tiling plan H1): `atmCloudNoise`
  through `atmCloudHexGrad` with the continuous uv's `dFdx`/`dFdy` (the
  cells' offsets jump at their edges, so implicit derivatives drew the
  lattice), `atmCloudNoiseLod` through `atmCloudHexLod`; the mean is
  `ATM_CLOUD_MEAN` (`CLOUD_HEX.textureMean`, the default texture's). `atmCloudNoiseLod` is the
  same two-octave sum through `textureLod` (the second octave one
  log2(frequency) coarser), for the slab's march, where implicit
  derivatives are undefined inside the loop. It expects
  `atmTransmittanceLut`, `atmSkyViewLut` and `atmSunDirection` declared
  before it. It also carries the column's chunk
  ([`cloud-column.ts.md`](cloud-column.ts.md)) and the forward phase's
  ([`cloud-sun.ts.md`](cloud-sun.ts.md)), the uniform `atmCloudForward`
  (a vec2: x the aureole's strength, y the silver lining's; (0, 0) = off) and `atmCloudForwardRadiance(dir, r, tau)`, the glow of a cloud
  of optical depth tau along the view (twin of `cloudForwardRadiance`,
  with the sun's transmittance at cloud height as its illuminance), which
  the dome and the slab add.
- The sky fragment includes the 2D cloud layer (`atmClouds`, with twins of
  `cloudDensity`, `cloudHorizonFade` and `cloudLitRadiance` from
  `cloud-layer.ts`; every constant interpolated from `CLOUD_LAYER`; the
  cover arrives as the uniform `atmCloudThreshold`). With
  `atmCloudForward.x + .y > 0` the dome adds the forward glow through the column
  along the view, faded like its cloud (horizon fade × aerial).
- The sun through clouds (round-3 plan 2026-09-27-0532, DEC-FB3-6): the
  disc is multiplied by `atmCloudDiscTransmittance(dir)` = e^(-k·τ·drawn),
  τ the column along the view read at its crossing of the 2 km middle, from
  the origin (`atmCloudAnchored` 0, the camera-centred dome) or from the
  camera in the world (1, the sheet and the slab), with the REAL threshold
  (`atmCloudSunThreshold`: the visible sky's is 2 in the sheet and slab
  modes), and "drawn" the share of the cloud the sky shows there (the dome's
  horizon fade or the sheet's and slab's far fade `atmCloudFarFadeM`, times
  the aerial melt: the column's `atmColumnDrawn`, which the cloud shadows
  share). An explicit-level read (`atmCloudNoiseLod(uv, 0)`): it
  runs for disc pixels only, a branch. k = `atmCloudDiscExponent`, 0 = off
  (exactly 1).
- `atmHorizonClampedDir(dir)` in the common chunk: the one horizon clamp
  the visible sky (when `atmClampHorizon > 0.5`) and the haze share.

## Invariants & assumptions

- Every function is a line-for-line twin of a TS function (model, mapping,
  scattering) and every constant is interpolated from the model.
- Every identifier is `atm` / `ATM_` prefixed: the haze patch injects this
  into three's programs, whose `common` chunk defines `saturate`,
  `luminance`… A collision is a silent compile failure.
- `glslFloat` always writes a `.` or an exponent (GLSL ES has no implicit
  int → float), and throws on non-finite values.
- Radiance LUTs are pre-scaled by 1000: twilight radiance for a unit sun at
  −4…−6° (~1e-6…1e-5) would otherwise be half-float subnormal; ×1000 makes it
  normal. Deep twilight (~1e-8 at −9°) stays subnormal, where the sky is
  black anyway.
- The sun disc uses the model's normalised limb darkening
  (`ATM_SUN_LIMB_DARKENING`), so it emits exactly the sun's illuminance.
- The visible sky's output is clamped to `ATMOSPHERE_MAX_SCENE_RADIANCE`: a
  composer renders it into a HALF-FLOAT target, and the golden-hour sun disc
  (auto-exposure ×22 on ~15 000× the sky's radiance) overflowed 65 504 to
  Inf in red and green, which bloom spread over the whole frame (M4, found
  on the look-dev page's desktop tier).
- The sky is written at `z = w` (depth 1): never clipped by any far plane
  (OsmDemo's runs 2 400…24 000 m), always behind opaque geometry.
- Dialect: three.js GLSL1-style `ShaderMaterial` (`gl_FragColor`,
  `texture2D`) on WebGL2.

## Examples

```ts
new THREE.ShaderMaterial({
  vertexShader: SKY_VERTEX_GLSL,
  fragmentShader: SKY_FRAGMENT_GLSL,
  uniforms: atmosphere.sharedUniforms, // plus atmSunDiscEnabled
});
```

## Tests

- `atmosphere-glsl.test.ts` — float literal formatting, `atm` prefixes in
  every generated shader, constants interpolated from the model, step count
  shared with the CPU quadrature; the disc's extinction (the real
  threshold, an explicit level, the drawn weight, exactly 1 when off) and
  the dome's glow (gated, the column along the view, faded like its cloud).
- `sky-atmosphere.test.ts`: every uniform the sky, the bake and the slab
  declare is supplied by the material.
- Compilation, drawing and GPU/CPU parity: the look-dev smoke
  (`GpsPlusSlamJs_DesignSystem/3d/lookdev.smoke.spec.mjs`), the only place a
  GPU exists.
