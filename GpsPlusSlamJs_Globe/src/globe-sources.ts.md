# globe-sources.ts - the one imagery registry

- Purpose: globe plan 2026-09-26-0539 §7.7. Every source the globe can load,
  with what loads it and its credit; the globe takes imagery only from here,
  so nothing loads uncredited.
- Public API:
  - `GLOBE_SOURCES` - `{ id, kind: "tiles" | "equirect" | "alpha", path,
levels?, projection?, colorSpace, grey?, credit: { short, full, href } }`: the
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
    plan 2026-10-08-2345 M1).
  - `globeSource(id)` - one entry; `RangeError` for an unknown id.
  - `GIBS_ACKNOWLEDGEMENT` - GIBS's acknowledgement, shown in full.
  - The types `GlobeCredit` (OsmDemo's attribution-entry shape),
    `GlobeSourceId`, `GlobeSource`.
- Invariants & assumptions: paths are served at `/globe-assets/` from
  `assets/`, written by `scripts/fetch-globe-assets.mjs` (provenance in
  `assets/PROVENANCE.md`). All four are NASA, public domain. Only the Blue
  Marble pyramid is on screen in M1; the three global maps arrive with the
  surface patch (M3).
- Tests: `globe-sources.test.ts` (unique ids, full credits, the committed
  pyramid complete with every tile a 256x256 WebP, more than half of them
  per level with water in their alpha and an open-Pacific tile among them,
  the water mask pointing at the same files, every global map a WebP of
  its size (the night 2048x1024, the clouds 4096x2048 since round-3 plan
  2026-10-08-2345 M1) under the 2 MiB file ceiling, and the whole `assets/` folder within
  its budget, decimal, as the owner stated it).
