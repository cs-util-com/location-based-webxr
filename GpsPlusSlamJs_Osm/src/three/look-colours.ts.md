# `three/look-colours.ts`

## Purpose

Draws a building or road chunk baked in several colour looks
(`MeshChunk.lookColours`, `CityOptions.looks`) as ONE mesh whose colour a
shared uniform mixes, so a blend of looks (a time of day) moves the whole
city with one uniform write and never a rebuild.

## Public API

- `LookMix`: `{ trimWeights: { value: Vector4 } }`, the one uniform object
  every look material of a city holds. `trimWeights` is each look's weight
  already multiplied by that look's brightness trim, so it need not sum to
  1; for the mesh shader only (the normalised look weights, which sum to 1,
  are the app's and go to the trees and the ground).
- `createLookMix()`: a mix on look 0 at weight 1, `(1, 0, 0, 0)`.
- `setTrimWeights(mix, weights)`: 1 to 4 weights, the rest 0. `RangeError`
  for none, more than four, or a weight that is not finite and >= 0; the
  mix is then unchanged.
- `checkedWeightList(weights, what)`: the weights when an array of finite
  numbers >= 0, else a `RangeError` naming `what`; shared with the trees'
  `checkedTreeLookWeights` (`tree-looks.ts`).
- `lookDecodeTexture()`: `LOOK_COLOUR_DECODE` as a 256x2 `RedFormat`
  `FloatType` `DataTexture`, nearest, no mipmaps: row 0 the linear decode,
  row 1 the raw one. Made on first use, shared, never disposed.
- `applyLookColours(geometry, material, lookColours, decode, mix)`: puts the
  K code buffers on the geometry as `lookColour0..K-1` (Uint8, 3,
  normalised), deletes `color`, switches the material's `vertexColors` off
  and patches it:
  - vertex shader: `lookDecoded(code)` fetches each channel's texel at
    `int(code * 255.0 + 0.5)` on row `LOOK_DECODE_ROW`, and
    `vLookColour = trimWeights.x * lookDecoded(lookColour0) + ...` over the
    K looks;
  - fragment shader: `diffuseColor.rgb *= vLookColour` right after
    `color_fragment`, where three's vertex colour would multiply;
  - program cache key `look-colours-<K>-<row>`;
  - `RangeError` for no looks, more than four, or a buffer that is not a
    `Uint8Array` of three codes per `position` vertex.
- Reached through `buildingObjects(chunks, { looks })` (row `linear`) and
  `roadObjects(chunks, { looks })` (row `raw`) in `city-objects.ts`.

## Invariants & assumptions

- **Frame equality at weight 1.** The decode texture holds the very table
  the CPU decode (`decodeLookColours`) uses, and the mix multiplies where
  the vertex colour did, so a looks build on one look at weight 1 (its trim
  folded in, as the fixed build's material trim) draws what the fixed build
  of that look draws. Checked in a browser by OsmDemo's
  `looks-programs.spec.js`.
- **Why a texture and no sRGB formula in GLSL:** the buildings' colours are
  linear and the roads' raw codes / 255 (two pipelines of today); one table
  with two rows serves both exactly, and a code is an index, not a value.
- **WebGL 2 only** (`texelFetch`, vertex texture fetch), as every three.js
  release this package supports.
- **Memory:** 3 bytes per vertex per look; four looks are the 12 bytes of
  the Float32 `color` they replace.
- The material's `color` still multiplies the result, so the app's noon
  gain on `neutralSurface` materials applies unchanged.

## Examples

```ts
const mix = createLookMix();
const meshes = [
  ...buildingObjects(city.buildings, { looks: mix }),
  ...roadObjects(city.roads ?? [], { looks: mix }),
];
// Each sun step: the look weights times each look's brightness trim.
setTrimWeights(mix, [0.4 * 1.0, 0.6 * 1.1]);
```

## Tests

`look-colours.test.ts`: the mix's start and padding and its `RangeError`s;
the decode texture's size, format, filters and data; the attributes
replacing `color`; the shader text (declarations, mix, decode row, the
multiply after `color_fragment`) and the shared uniform objects; the cache
key per look count and row; the refusals; `buildingObjects` and
`roadObjects` using the looks only with a mix and decoding on their rows.
The GLSL compile and frame equality run in OsmDemo's browser spec
`looks-programs.spec.js`.
