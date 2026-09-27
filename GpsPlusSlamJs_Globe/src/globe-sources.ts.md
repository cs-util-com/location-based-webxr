# globe-sources.ts - the one imagery registry

- Purpose: globe plan 2026-09-26-0539 §7.7. Every source the globe can load,
  with what loads it and its credit; the globe takes imagery only from here,
  so nothing loads uncredited.
- Public API:
  - `GLOBE_SOURCES` - `{ id, kind: "tiles" | "equirect", path, levels?,
projection?, colorSpace, credit: { short, full, href } }`: the Blue
    Marble pyramid (levels 0-4; level 4 is DEC-FB2-4), Black Marble 2016, the MODIS water mask,
    the Blue Marble clouds. `colorSpace` says how the shader reads it:
    `srgb` for colour (the tiles, the night lights), `linear` for numbers
    (the water mask, and the clouds, whose grey level is read as coverage).
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
  pyramid complete with every tile a 256x256 JPEG, every global map
  2048x1024 and under the 2 MiB file ceiling, and the whole `assets/`
  folder within its 4.5 MB budget, decimal, as the owner stated it:
  4,451,405 bytes on 2026-09-27, so about 1 % headroom).
