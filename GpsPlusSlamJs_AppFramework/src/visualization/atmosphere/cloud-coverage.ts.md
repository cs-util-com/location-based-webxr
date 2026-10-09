# cloud-coverage.ts

## Purpose

The clouds from a coverage map, and a disc around the camera, shared by
the cloud slab (`cloud-slab.ts`) and the cloud shadow (`cloud-shadow.ts`)
so the shadow falls from exactly the clouds the slab draws (globe
volume-cloud plan `2026-10-05-0016-globe-volume-cloud-variants-plan.md`, C1
and C3; DEC-H3, one implementation).

## Public API

- `CloudCoverage`: `{ glsl, uniforms }`, the caller's GLSL declaring its
  uniforms and defining `float atmCloudCoverageAt(vec2 xz)`, the local
  cover (0 … 1) at world x/z (metres).
- `cloudCoverThresholds(hex = false)`: the noise threshold for each cover
  k / 32, k = 0 … 32 (`cloudThreshold`, the global cover's own quantile
  rule), 2 (clear) at cover 0; computed once; the shader's
  `atmCoverThresholds`. With `hex`, the hex-tiled field's table
  (`HEX_COVER_THRESHOLDS`, `cloud-hex.ts`), the shader's
  `atmCoverThresholdsHex`: both are carried and the GLSL's
  `atmCloudThresholdAt(xz, threshold, cover, hex)` picks by its fourth
  argument, so a live hex switch rewrites no table (hex-tiling plan H1).
- `cloudThresholdForCover(cover, hex = false)`: linear between the table's entries, the
  cover clamped to [0, 1]; RangeError for NaN.
- `cloudDiscThreshold(threshold, horizontalM, radiusM)`: the threshold faded
  to clear from 0.7 r to r around the camera (smoothstep); RangeError for a
  radius not positive or a negative distance.
- `CLOUD_COVERAGE_GLSL`: the chunk both shaders include. Its
  `atmCloudThresholdAt(xz, threshold, cover)` returns the map's threshold
  (the local cover times `cover`, behind `ATM_CLOUD_COVERAGE`) or
  `threshold`, faded at the disc (`atmCoverDiscM`, behind `ATM_CLOUD_DISC`),
  centred on `atmCoverDiscCentre` (world x, z), or on the camera while its
  z is 1 (the default; volume-cloud plan §15).
  Without either define it returns `threshold`.
- `cloudCoverageUniforms()`: the uniforms the chunk declares, neutral (the
  table clear, a 1 m disc following the camera) until set; a fresh object
  each call.
- `CloudDiscCentre` and `writeCloudDiscCentre(uniform, centre | null)`
  (§15): writes a world point into the centre uniform, or turns it back to
  the camera (null), so the slab and the shadow share one rule.
  RangeError for a centre that is not finite.
- `withCloudCoverage(fragment, glsl)`: the fragment with the caller's chunk
  inserted at the chunk's place; RangeError for a chunk without
  `atmCloudCoverageAt` or a fragment without the chunk.

## Invariants & assumptions

- One per-position threshold carries both the map and the disc, so the
  callers' marches, light and columns stay as they are; the CPU twins are
  `cloudSlabMarch`'s `thresholdAt` and the helpers above.
- The disc reads `cameraPosition`: a shadow with a disc depends on the
  camera by design (it is the volume's, centred on the camera); without
  the define the shadow is the same from every viewpoint.

## Examples

```ts
setCloudSlabCoverage(slab, {
  glsl: myChunk,
  uniforms: { uMap: { value: map } },
});
shadow.configureMap({ coverage: { glsl: myChunk, uniforms }, disc: true });
```

## Tests

`cloud-coverage.test.ts`: the table against the noise quantiles, the
interpolation and clamping, the disc's fade and monotony, the chunk's
defines and function, the neutral uniforms, and the insertion's refusals.
The slab's and the shadow's own tests cover their use of it.
