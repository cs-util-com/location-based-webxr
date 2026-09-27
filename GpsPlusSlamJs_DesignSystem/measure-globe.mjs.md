# measure-globe.mjs - the globe lab's memory and download table

- Purpose: globe plan 2026-09-26-0539 §7.8, M4. What the globe lab loads to
  settle on one daylight view over North Africa and Europe, at the lab's
  defaults: for each error target (0.25, 0.5, 1, 2, 4, 16 px; below 1 px
  is where the committed level 4 starts to load on this view) on a desktop (1280x800
  at DPR 1) and a phone (412x915 at DPR 2), and for the phone's finest view
  under smaller tile caches (48 and 32 MiB). Columns: the error target, the
  pixel ratio actually used, the cache cap, tiles loaded, tiles refused by
  a full cache, the tiles requested per pyramid level (`tileRequestsByLevel`),
  bytes downloaded, the tile cache's bytes, and three's GPU
  texture and geometry counts. The progress entry's table is this script's
  output, never typed by hand.
- Use: `pnpm run measure:globe` from `GpsPlusSlamJs_DesignSystem/`. Output: a
  markdown table on stdout and in `shots/globe-measure.md` (gitignored).
- Invariants & assumptions:
  - Each row runs in a fresh browser context against `serve.mjs`
    (`no-store`), so the download count starts at zero and counts real
    downloads. The page's `bytesDownloaded` sums the resource timing log's
    `/globe-assets/` entries (`transferSize`, or the body size where that
    reads 0), so on a cached server it would count cache hits too.
  - A row is taken only once nothing is pending and the loaded and refused
    counts have held still for 1 s: children of a just-parsed tile are
    queued only at the next update, so a single poll can see "nothing
    pending" between two levels.
  - Refused tiles are the library's `stats.refused` (the surface's
    `refusedTiles`): not pending, so a starved cache would otherwise look
    settled and merely soft.
  - It starts `serve.mjs` through `start-aux-server.mjs` (the aux port 5198,
    127.0.0.1), like `shoot-3d.mjs`. Not a gate: headless Chromium, so
    counts are real and timings are not. Console and page errors fail it.
- Tests: none of its own. The page fields it reads are live in the globe
  lab smoke (`labs/globe/globe.smoke.spec.mjs`): `loadedTiles`,
  `bytesDownloaded` (above 0 and under 20 MiB), `rendererMemory.textures`,
  `cachedBytes`, `refusedTiles` (0 at the default cap), `pixelRatio` (at
  DPR 2); `tileRequestsByLevel` in `labs/globe/globe-sky.smoke.spec.mjs`
  (level 4 requested at a 0.25 px target).
