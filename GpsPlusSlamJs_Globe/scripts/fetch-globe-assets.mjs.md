# scripts/fetch-globe-assets.mjs - fetch the globe's imagery

- Purpose: globe plan 2026-09-26-0539 §7.4, owner decision DEC-PRG-12:
  about 2 MB of NASA imagery committed under `assets/`, regenerable; level 4
  added by DEC-FB2-4 (round-2 plan 2026-09-26-2055 M3c), level 5 by round
  4's DEC-GL4-3 (`MAX_LEVEL` 5).
- Use: `node scripts/fetch-globe-assets.mjs [--force]` from the package, by
  hand, never in CI. Node 26 runs it as is (it imports `../src/*.ts` through
  Node's own type stripping).
- What it writes (round-4 plan 2026-09-28-2105 DEC-GL4-3/6/10): every
  file WebP at `WEBP_QUALITY`, encoded ONCE from a lossless source, never
  from a JPEG: `assets/blue-marble-4326/{z}/{x}/{y}.webp` (via GIBS WMS
  `BlueMarble_NextGeneration` as PNG), each tile's alpha the MODIS water
  mask (`MODIS_Water_Mask` as PNG on the same box) kept only where the
  imagery shows dark sea (`src/water-alpha.ts`), lossless: land 255,
  water 0, the colour under the water kept by `exact`; a tile with no
  water has no alpha); `assets/equirect/` night (VIIRS Black Marble 2016,
  as PNG) and clouds (NASA Visible Earth's `cloud_combined_8192.tif` at
  full resolution, round-3 plan 2026-10-08-2345 §18, DEC-R3-13..15: its
  date-line seam eased over `SEAM_COLUMNS` (16) columns from each edge by
  `src/cloud-seam.ts` (§16), cut by the registry's `globeMapPieces` into
  four 4096x2048 pieces, `clouds-8192-{col}-{row}.webp`, and resampled
  with Lanczos to the 1024x512 preview, `clouds-1024.webp`; one download
  makes five files, so the clouds are written by `writeClouds`, not a
  `jobs` entry; the run logs the wrap before and after against a typical
  pair of columns);
  and `assets/PROVENANCE.md` (sources, sizes, licence, the GIBS
  acknowledgement). The downloads are kept in `.fetch-cache/`
  (gitignored), so a re-encode at another quality needs no network.
- Checks: every download by its header (TIFF by decoding it, its grey
  channel read as one channel: sharp writes a one-channel raw input back
  out as three channels, so every read takes channel 0); every mask
  pixel is water cyan or transparent land (a GIBS style change fails the
  run instead of drawing a wrong coast); every written WebP's size, and
  its alpha present exactly when the tile has water. `sharp` is a
  devDependency of this package for the encoding (it is never loaded by
  the page).
- Invariants: every file is checked by its header (type and size) before it
  is written; concurrency 4, 3 retries; existing files are kept unless
  `--force`; the "Fetched:" dates come from `src/provenance-date.ts`
  (unit-tested): a run that adds files keeps the first fetch date and
  records its own as "files added", and `--force` records today alone.
  Measured 2026-09-26: 173 files, 1.94
  MiB (levels 0-3); 2026-09-27 with level 4: 685 files, 4,451,405 bytes
  (level 4 alone 512 files, 2.42 MB, above the plan's 1.9 MiB estimate from
  48 sampled tiles); 2026-09-30 with level 5, as WebP: 2,734 files,
  8,847,906 bytes (levels 0-5 2,730 tiles, 8,234 KiB); 2026-10-09 with the
  8,192 clouds: 2,736 files, 12,579,146 bytes (the pieces 3,978,662, the
  preview 104,220). `globe-sources.test.ts` holds the total under 13 MB
  (DEC-R3-13; 10 MB from round-4 DEC-GL4-9, 4.5 MB before). GIBS's WMS reports no
  `layer-time-actual`, so the Blue Marble month is recorded as not reported.
- Tests: the pieces it imports are unit-tested (`image-header.ts`,
  `tile-pyramid.ts`, `provenance-date.ts`, `cloud-seam.ts`, the
  registry's `globeMapPieces`); `globe-sources.test.ts` checks what it committed.
