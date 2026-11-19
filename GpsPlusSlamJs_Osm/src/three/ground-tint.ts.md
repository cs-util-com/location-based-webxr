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
  cache key and colour: the very functions it found (called with the
  material as `this` while patched), so repeated rebuilds leave no chain of
  wrappers. Tested in `ground-tint.test.ts`.
- **One set of uniform objects per material**, reused by every
  application (a module `WeakMap`). three.js runs `onBeforeCompile` only when
  a material has no program for its cache key yet and keeps binding the
  uniforms of that compile, so a dispose-then-apply under the same key
  (every rebuild in the OSM demo) reuses the first program: fresh uniform
  objects per application left it sampling the first, freed texture and the
  ground went dark after every rebuild (found 2026-11-10 by the colour-scheme
  switch e2e). Only the latest application is live: an older handle's
  `setEnabled` and `dispose` do nothing to the material.
- Why RGBA8 and not an R8 index: the spike in `mesh/ground-tint.ts.md`.

## Tests

- `ground-tint.test.ts` - texel bytes and order, colour space and mipmaps,
  unknown class bytes, the size check, the shader patch and its uniforms, a
  chained hook, the cache key, the switch, `dispose`, the fade check; a later tint reaching the program
  compiled for an earlier one, and a stale handle being inert.

## Looks: class and palette textures (time-of-day colour blend plan 2026-11-18-1913)

- `groundClassTexture(tint)`: the class raster as an R8 `DataTexture`, `NearestFilter` both ways, no mips (filtering would blend class indices), `unpackAlignment` 1 (odd widths). RangeError when the classes do not match the size.
- `groundPaletteTexture(tint)`: `lookPalettes` as an RGBA8 sRGB texture, palette length wide and `MAX_CITY_LOOKS` (4) high, row k look k (rows past the last look repeat row 0; their weight is 0), nearest, no mips. RangeError without look palettes, with more than 4, or with rows of different lengths. Row k at each texel's class is exactly the RGBA `groundTintTexture` gives look k (test-held).
- `applyGroundTint` on a tint with `lookPalettes` builds those two textures instead of the RGBA one and compiles a separate program (cache key `|ground-tint-looks`): per fragment it fetches the class (an index past the palette reads as 0, the neutral), fetches the four palette rows with `texelFetch` (decoded from sRGB by the format), and mixes them in linear light by `groundWeights` (a vec4, look 0 alone until set).
- `AppliedGroundTint.setLookWeights(weights)`: one weight per look, each finite and >= 0, not normalised (the caller sums to 1). RangeError for a wrong count or value, and on a tint without looks.
- `AppliedGroundTint.setNeutral(rgb)`: the fade-to neutral, sRGB 0xRRGGBB; works on both kinds of tint. RangeError for anything else.
- `dispose` frees whichever textures it built and nulls `groundTint`, `groundClasses` and `groundPalette`.
- **Not pixel-identical to the fixed tint at a class edge**: the fixed texture is sampled with linear filtering and mips, the looks mode nearest, so at weight 1 the two agree inside a class and differ along its edges. The data equality is test-held; a frame comparison must allow for the edges.
- Tests: `ground-tint.test.ts` ("applyGroundTint with looks").
