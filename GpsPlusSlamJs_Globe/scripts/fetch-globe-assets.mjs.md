# scripts/fetch-globe-assets.mjs - fetch the globe's imagery

- Purpose: globe plan 2026-09-26-0539 §7.4, owner decision DEC-PRG-12:
  about 2 MB of NASA imagery committed under `assets/`, regenerable; level 4
  added by DEC-FB2-4 (round-2 plan 2026-09-26-2055 M3c).
- Use: `node scripts/fetch-globe-assets.mjs [--force]` from the package, by
  hand, never in CI. Node 26 runs it as is (it imports `../src/*.ts` through
  Node's own type stripping).
- What it writes: `assets/blue-marble-4326/{z}/{x}/{y}.jpg` (levels 0-4,
  682 tiles, via GIBS WMS `BlueMarble_NextGeneration`), `assets/equirect/`
  night (VIIRS Black Marble 2016), water (MODIS MOD44W) and clouds (NASA
  Visible Earth), and `assets/PROVENANCE.md` (sources, sizes, licence, the
  GIBS acknowledgement).
- Invariants: every file is checked by its header (type and size) before it
  is written; concurrency 4, 3 retries; existing files are kept unless
  `--force`; a run that only adds files keeps the first fetch date and
  records its own as "files added" (the date is matched as a date: a
  capture of `\S+` once took the sentence's full stop with it and wrote
  "2026-09-26.."). Measured 2026-09-26: 173 files, 1.94
  MiB (levels 0-3); 2026-09-27 with level 4: 685 files, 4,451,405 bytes
  (level 4 alone 512 files, 2.42 MB, above the plan's 1.9 MiB estimate from
  48 sampled tiles). `globe-sources.test.ts` holds the total under 4.5 MB. GIBS's WMS reports no
  `layer-time-actual`, so the Blue Marble month is recorded as not reported.
- Tests: the pieces it imports are unit-tested (`image-header.ts`,
  `tile-pyramid.ts`); `globe-sources.test.ts` checks what it committed.
