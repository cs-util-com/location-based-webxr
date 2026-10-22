# globe-sources.ts - the one imagery registry

- Purpose: globe plan 2026-09-26-0539 §7.7. Every source the globe can load,
  with what loads it and its credit; the globe takes imagery only from here,
  so nothing loads uncredited.
- Public API:
  - `GLOBE_SOURCES` - `{ id, kind: "tiles" | "equirect" | "alpha", path,
levels?, projection?, colorSpace, grey?, pieces?, credit: { short, full, href } }`: the
    Blue Marble pyramid (WebP; levels 0-5, level 4 is DEC-FB2-4, level 5
    DEC-GL4-3), Black
    Marble 2016, the MODIS water mask, the Blue Marble clouds. The water
    mask is `kind: "alpha"` (round-4 plan 2026-09-28-2105 DEC-GL4-6): it
    rides in the imagery tiles' alpha, cut to the same tiles, so its
    `path` is the tiles' own and it keeps its own credit. `colorSpace`
    says how the shader reads it: `srgb` for colour (the tiles, the night
    lights), `linear` for numbers (the water mask, and the clouds, whose
    grey level is read as coverage). `grey: true` (the clouds) sends a
    grey map to the GPU as one channel, a quarter of the memory (round-3
    plan 2026-10-08-2345 M1). `pieces` (the clouds, round-3 plan §18,
    DEC-R3-13..15): the map's full size cut into a grid (`{ path, columns,
rows, width, height }`, a `{col}`/`{row}` template, row 0 the north),
    each piece under the repo's 2 MiB file ceiling; `path` is then the
    small preview the globe shows until the pieces are in. The clouds:
    the 1,024 x 512 preview and NASA's 8,192 x 4,096 map in four
    4,096 x 2,048 pieces.
  - `globeMapPieces(source)` - a cut map's pieces, row by row from the
    north, each with its `path`, `column`, `row` and its place in the
    whole map's pixels (`left`, `top` from the north, `width`,
    `height`); `[]` for a source that is not cut; `RangeError` when the
    grid does not divide the map evenly. The fetch script cuts by it and
    the globe joins by it, so the two cannot disagree.
  - `globeSource(id)` - one entry; `RangeError` for an unknown id.
  - `GIBS_ACKNOWLEDGEMENT` - GIBS's acknowledgement, shown in full.
  - The types `GlobeCredit` (OsmDemo's attribution-entry shape),
    `GlobeSourceId`, `GlobeSource`, `GlobeMapPiece` (the grid itself,
    `GlobeMapPieces`, is module-private: `GlobeSource.pieces` carries it).
- Invariants & assumptions: paths are served at `/globe-assets/` from
  `assets/`, written by `scripts/fetch-globe-assets.mjs` (provenance in
  `assets/PROVENANCE.md`). All four are NASA, public domain. Only the Blue
  Marble pyramid is on screen in M1; the three global maps arrive with the
  surface patch (M3).
- Tests: `globe-sources.test.ts` (unique ids, full credits, the committed
  pyramid complete with every tile a 256x256 WebP, more than half of them
  per level with water in their alpha and an open-Pacific tile among them,
  the water mask pointing at the same files, every global map a WebP of
  its size (the night 2048x1024, the clouds' preview 1024x512) under the
  2 MiB file ceiling, the clouds' four 4096x2048 pieces likewise and no
  other cloud file, the pieces' placement, the committed pieces' date-line
  wrap no worse than a typical pair of columns and their joins inside the
  map's own range (`cloud-seam.ts`), and the whole `assets/` folder
  within its budget, 13 MB decimal since DEC-R3-13, as the owner stated
  it).
