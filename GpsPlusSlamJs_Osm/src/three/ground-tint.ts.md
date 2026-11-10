# `three/ground-tint.ts`

## Purpose

Draws a `GroundTint` (`mesh/ground-tint.ts`) on a three.js ground material:
an sRGB RGBA8 texture with mipmaps over the build window and O2's fragment
patch, which multiplies the diffuse colour by the class colour and fades to
the neutral ground over the last `GROUND_TINT_FADE_M` (40 m) of the window
(city objects plan 2026-11-07-2315 M3).

## Public API

- `groundTintTexture(tint, anisotropy = 1) -> THREE.DataTexture` - one
  RGBA8 texel per class byte, `SRGBColorSpace`, linear-mipmap filtering,
  clamped. A class byte without a palette entry is the neutral ground.
  `RangeError` when `classes` does not match `width * height`.
- `applyGroundTint(material, tint, {fadeM?, enabled?, anisotropy?})
-> {setEnabled(on), dispose()}` - patches `onBeforeCompile` (chaining an
  existing hook) and `customProgramCacheKey` (`|ground-tint`), sets the
  material colour to white. `RangeError` for a negative or non-finite
  `fadeM`.

## Invariants & assumptions

- World xz is east and minus north (the render convention); the shader
  turns it back into ENU before sampling. Row 0 of the texture is south.
- **The material stays white in both states.** Off (`groundOn` 0) the patch
  multiplies by the neutral everywhere, which is the plain ground; a neutral
  material colour there would square it.
- The neutral is `tint.palette[0]`, converted by `THREE.Color` to linear;
  the texture is decoded from sRGB by the GPU, so both sides are linear.
- `dispose()` frees the texture and restores the material's own hook,
  cache key and colour.
- Why RGBA8 and not an R8 index: the spike in `mesh/ground-tint.ts.md`.

## Tests

- `ground-tint.test.ts` - texel bytes and order, colour space and mipmaps,
  unknown class bytes, the size check, the shader patch and its uniforms, a
  chained hook, the cache key, the switch, `dispose`, the fade check.
