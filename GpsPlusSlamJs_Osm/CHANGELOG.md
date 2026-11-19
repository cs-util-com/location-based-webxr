# Changelog

## [Unreleased]

### Added

- **Buildings, roads and trees can draw a mix of their looks** (`three`):
  `buildingObjects` and `roadObjects` take `{ looks }`, a shared
  `LookMix` (`createLookMix`, `setTrimWeights`): a chunk's
  `lookColours` then replace `colors` as K normalised Uint8 attributes,
  decoded in the vertex shader through `lookDecodeTexture` (the
  `LOOK_COLOUR_DECODE` table, the linear row for buildings, the raw row
  for roads) and summed by the `trimWeights` vec4, so a blend moves with
  one uniform write (`applyLookColours`). `setTreeLookWeights` mixes the
  trees' crown colours on the CPU in both tree forms, and `packInstances`
  packs `lookColours` per variant.
- **A city can be baked in several colour schemes at once** (`mesh`):
  `CityOptions.looks` takes up to `MAX_CITY_LOOKS` (4) colour schemes and
  builds the geometry once. Every building and road chunk then carries
  `MeshChunk.lookColours` (one sRGB byte buffer per look, decoded exactly
  by `decodeLookColours` / `LOOK_COLOUR_DECODE`), every tree and cosmetic
  tree `lookColours`, and the ground tint `lookPalettes` over its one class
  raster. Look k's colours equal a build with `colours: looks[k]`; without
  `looks` the build is unchanged byte for byte. `chunkMeshes` takes the
  per-look paints as its eighth parameter (`LookPaint`). An empty list, more
  than four looks, a malformed look or `colours` other than `looks[0]`
  throw `RangeError`.
- **The ground tint can mix its looks on the GPU** (`three`):
  `groundClassTexture` and `groundPaletteTexture` give the class raster
  (R8, nearest) and the mixed palette (one linear float row); on a tint
  with `lookPalettes`, `applyGroundTint` filters four class texels by hand
  through that palette, so a magnified class edge looks as the fixed tint's
  does, and `AppliedGroundTint.setLookWeights` re-mixes the palette.
  `setNeutral` sets the colour the tint fades to at its edge, on either
  kind of tint.
