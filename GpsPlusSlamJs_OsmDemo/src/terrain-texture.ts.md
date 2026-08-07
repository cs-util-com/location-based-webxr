# `src/terrain-texture.ts`

## Purpose

Turns a heightfield into texture data for the GPU displacement path (W23), and
provides the JS mirror of the sampling the vertex shader performs — because jsdom
cannot compile a shader, so the GLSL itself is untestable in CI.

## Public API

- `TerrainTexture` — `{ data, side, extentM, spacingM }`. `data` is **datum-relative**
  metres, row-major.
- `terrainTextureFrom(field) → TerrainTexture | undefined` — `undefined` when the
  field has no data, so the caller can fall back honestly rather than draw a flat
  surface shaped exactly like an outage.
- `textureUv(v, extentM, side) → number` — ENU metres to a texture coordinate.
- `sampleTerrainTexture(texture, x, y) → number` — what the shader computes.
- `terrainNormal(texture, x, y) → [x, y, z]` — 4-tap finite-difference normal.

## Invariants & assumptions

- **The data is DATUM-RELATIVE, and getting this wrong is silent.**
  `HeightfieldData.heights` are absolute orthometric metres (~53 m at Cologne);
  `heightfieldFrom` subtracts `datum` on _read_, it is not baked into the array.
  Uploading verbatim lifts the whole city off a camera framed at `y = 10`, and
  the symptom ("the buildings are floating") points nowhere near here.
  - It is also what makes **half-float storage viable**: 16-bit float has ~11
    bits of mantissa, which resolves ±100 m of relief to about 6 cm and is
    useless for absolute altitude. Two independent reasons, one decision.
- **`spacingM` is DERIVED**, because `HeightfieldData` carries no spacing field —
  the pitch is implicit in `extentM * 2 / (side - 1)`. The shader needs it as its
  own uniform; computing it in two places is how the two drift.
- **`sampleTerrainTexture` must agree with `heightAt`.** Both displacement paths
  ship and are switchable at runtime, so the same ground has to come out of both.
  If they disagree, toggling the mode moves the buildings relative to the terrain
  and the GPU becomes a second source of truth for ground height — the defect
  DEC-R2-21 rejected `geo-three` for, self-inflicted.
- **`textureUv` addresses texel CENTRES.** A coordinate of `0` is the outer edge
  of the first texel, so grid index `g` maps to `(g + 0.5) / side`. Half a texel
  out shifts the surface by half a post — ~6 m here, which reads as the DEM being
  misregistered rather than as an arithmetic error.
- **Sampling clamps outside the extent**, matching `bilinear`'s per-axis clamp.
- **A non-finite post becomes 0 (the datum), never `NaN`.** One `NaN` vertex
  removes the whole draw call in three.js with no error.
- **`terrainNormal` exists so the GPU path is correct under smooth shading too.**
  With the ground's current `flatShading: true`, three.js derives the fragment
  normal from screen-space derivatives of the displaced position, so facets are
  shaded correctly even without it. It is computed anyway because shipping
  displacement with knowingly wrong normals is exactly what `geo-three` does —
  its shader rewrites `gl_Position` only, so its terrain is lit as if flat.

## Examples

```ts
const texture = terrainTextureFrom(field);
// The view converts to half-float and uploads; see building-view.ts.
```

## Tests

`terrain-texture.test.ts` — 12 tests. The datum test uses a **realistic 53 m
datum**, because a datum of 0 would pass code that uploads the heights verbatim —
the exact bug this module exists to avoid.

The load-bearing one is "matches heightAt across the field", which sweeps a grid
and compares against the real sampler. The end-to-end half — that the _shader_
implements this arithmetic and not something else — is
`playwright-tests/` › "displaces the ground on the GPU, and it matches the CPU
path", whose threshold was measured (116 differing pixels working, 8990 with the
displacement line deleted) rather than chosen.
