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
- The sky fragment includes the 2D cloud layer (`atmClouds`, with twins of
  `cloudDensity`, `cloudHorizonFade` and `cloudLitRadiance` from
  `cloud-layer.ts`; every constant interpolated from `CLOUD_LAYER`; the
  cover arrives as the uniform `atmCloudThreshold`).
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
  shared with the CPU quadrature.
- Compilation, drawing and GPU/CPU parity: the look-dev smoke
  (`GpsPlusSlamJs_DesignSystem/3d/lookdev.smoke.spec.mjs`), the only place a
  GPU exists.
