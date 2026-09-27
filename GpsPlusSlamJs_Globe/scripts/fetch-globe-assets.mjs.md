# scripts/fetch-globe-assets.mjs - fetch the globe's imagery

- Purpose: globe plan 2026-09-26-0539 §7.4, owner decision DEC-PRG-12:
  about 2 MB of NASA imagery committed under `assets/`, regenerable.
- Use: `node scripts/fetch-globe-assets.mjs [--force]` from the package, by
  hand, never in CI. Node 26 runs it as is (it imports `../src/*.ts` through
  Node's own type stripping).
- What it writes: `assets/blue-marble-4326/{z}/{x}/{y}.jpg` (levels 0-3,
  170 tiles, via GIBS WMS `BlueMarble_NextGeneration`), `assets/equirect/`
  night (VIIRS Black Marble 2016), water (MODIS MOD44W) and clouds (NASA
  Visible Earth), and `assets/PROVENANCE.md` (sources, sizes, licence, the
  GIBS acknowledgement).
- Invariants: every file is checked by its header (type and size) before it
  is written; concurrency 4, 3 retries; existing files are kept unless
  `--force`; a run that only adds files keeps the first fetch date and
  records its own as "files added" (the date is matched as a date: a
  capture of `\S+` once took the sentence's full stop with it and wrote
  "2026-09-26.."). Measured 2026-09-26: 173 files, 1.94 MiB. GIBS's WMS reports no
  `layer-time-actual`, so the Blue Marble month is recorded as not reported.
- Tests: the pieces it imports are unit-tested (`image-header.ts`,
  `tile-pyramid.ts`); `globe-sources.test.ts` checks what it committed.
