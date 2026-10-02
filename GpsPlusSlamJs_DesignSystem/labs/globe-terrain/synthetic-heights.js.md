# synthetic-heights.js - Terrarium heights generated in the page

- Purpose: round-5 F1a/F1: the globe lab (`relief=1&reliefHeights=synthetic`)
  and the terrain-carrier lab draw the library's terrain tiles from heights
  generated in the page, so their smokes need no network. One
  implementation for both pages (DEC-H3).
- Public API:
  - `SYNTHETIC_HEIGHTS_URL`: the URL template the pages hand the carrier.
  - `syntheticTile(z, x, y, seaM = 0)` -> `Promise<Blob>`: a 256 px
    Terrarium PNG of a 1 km plateau with ridges of about 5-50 km
    (0-2,200 m), lowered by `seaM` (a coast where it goes below 0).
  - `installSyntheticHeights({ seaM })` -> `{ requests, bytes() }`: wraps
    `window.fetch` to serve the template from the page and records every
    height tile asked for (synthetic or the live Terrarium's, `z/x/y`) and
    the synthetic PNGs' bytes.
- Invariants & assumptions: the PNG sizes are NOT representative of real
  Terrarium tiles (procedural detail compresses worse);
  `terrarium-bytes.mjs` sizes the recorded requests from AWS instead. Needs
  `OffscreenCanvas` (a browser page).
- Tests: through the pages' smokes (`globe-terrain.smoke.spec.mjs`,
  `../globe/globe-relief.smoke.spec.mjs`).
