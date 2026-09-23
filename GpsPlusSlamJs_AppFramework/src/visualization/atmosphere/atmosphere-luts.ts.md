# atmosphere-luts.ts

## Purpose

The atmosphere's GPU half, deliberately thin: three LUT render passes, the
environment bake (cube + PMREM), half-float readbacks, context-restore
notification. All decisions live in `sky-atmosphere.ts`, which talks to this
through the `AtmosphereDevice` interface so its bookkeeping is testable
without a GPU.

## Public API

- `LutName` — `'transmittance' | 'multiScattering' | 'skyView'`.
- `AtmosphereUniforms` — the one set of shared uniform objects.
- `AtmosphereDevice` — `supported`, the three textures, `render(lut,
uniforms)`, `bakeEnvironment(scene)`, `readSkyView()`, `readTexel(lut, x,
y)`, `onContextRestored(listener)`, `dispose()`.
- `WebGlAtmosphereDevice` — the WebGL implementation; `supported` means
  `EXT_color_buffer_half_float` OR `EXT_color_buffer_float`.

## Invariants & assumptions

- LUTs are `HalfFloatType` RGBA, linear filtering, clamp to edge, no depth
  buffer. Environment cube 64², half float, then `PMREMGenerator.fromCubemap`.
- Readbacks do NOT use `readRenderTargetPixels`: for a half-float target
  three asks for `readPixels(RGBA, HALF_FLOAT)`, which WebGL2 only allows
  where the driver's implementation-defined read type says so (SwiftShader
  does; a phone may not, and the read then fails silently). With
  `EXT_color_buffer_float` the device reads `RGBA/FLOAT` (guaranteed),
  otherwise it tries `HALF_FLOAT`; `gl.getError()` decides, and a failure
  returns `null` (`readTexel`: NaN). Synchronous GPU stalls, once per sun
  change, never per frame.
- `render` restores the previous render target.
- Render-target contents do not survive a context loss; the owner re-renders
  on `webglcontextrestored`.

## Examples

```ts
const device = new WebGlAtmosphereDevice(renderer);
if (!device.supported) {
  /* keep the fallback sky */
}
```

## Tests

No unit test (it is the part CI cannot run). Exercised by the look-dev smoke
(`GpsPlusSlamJs_DesignSystem/3d/lookdev.smoke.spec.mjs`): every pass draws,
readbacks feed the GPU/CPU parity check. `sky-atmosphere.test.ts` pins the
interface with a fake.
