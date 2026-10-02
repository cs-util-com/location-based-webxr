# globe-terrain-lab.js - the relief carrier, side by side with the globe

- Purpose: round-5 plan 2026-10-01-0945 §8 DEC-GL5-9, F1a (the decided
  choice of the tile library's terrain tiles as the relief): the carrier
  from `/globe/globe-terrain.js` drawn with the globe's own look and sun,
  or the globe's own surface at the same view, so the smokes hold the
  carrier to the globe. It is a measuring page; the relief is NOT in the
  default flight yet (F1 proper, after a review). Results:
  `GpsPlusSlamJs_Docs/docs/2026-10-02-0307-globe-f0-frame-and-carrier-spike-results.md`
  and the round-4 results record.
- Hash parameters: `carrier` (`terrain`, the default, or `globe`); `alt`
  (km above 46.5 N 9.0 E, default 150), the camera looking north and down
  at 45 degrees, or straight down with `nadir=1`; `time` (an hour UTC on
  the 2026 March equinox, default 11.4: the sun overhead at 9 E, 43.5
  degrees up at the target); `heightScale` (default 1); `errorTarget`
  (the library's, default 1, its recommended setting); `heights`
  (`synthetic`, the default: Terrarium tiles generated in the page, a 1 km
  plateau with ridges of 5-50 km, 0-2,200 m, so nothing leaves
  127.0.0.1; or `terrarium`, the live AWS tiles from the Osm library's
  `TERRARIUM_URL_TEMPLATE`, with its credit shown); `hideFloatLinear=1`
  (hides OES_texture_float_linear from the page, as on a device without
  it); `debug=height` (each pixel the tile's height as grey, 0-3,000 m,
  the background magenta, for the seam scan).
- Test API, `window.__terrainCarrier`: `ready`, `error`, `look` (the
  parameters), `setAlt(km)`, `settled()` (all loaded, nothing queued,
  downloading or parsing), `frameCost(frames)` (mean ms, each frame
  finished by a one-pixel read), `state()` (`visibleTiles`,
  `visibleByDepth`, `triangles`, `heightRequests` (every height tile
  asked for, `z/x/y`), `syntheticBytes`, `litTiles`, `floatLinear`,
  `drawingBuffer`), `probeHeight()` (the first tile's height texture as
  the GPU samples it midway between two texels, against the CPU value:
  `{ internalFormat, cpuMidwayM, gpuMidwayM }`), `readPixels(points)`,
  `seamScan(fromY, thresholds)` (every pixel below `fromY`: the cracks
  showing the background, and the steps between horizontal neighbours
  over each threshold).
- Invariants & assumptions:
  - The carrier wears the globe's template and reads the globe's uniforms
    (`createGlobeSurface().template`); the globe's tiles are hidden and
    not updated in carrier mode, its sun light still lights the scene.
  - Both carriers are drawn in ECEF (no re-orientation yet: F1 proper).
  - The synthetic tiles' PNG sizes are not representative of real
    Terrarium tiles: the data smoke writes the requested tiles to
    `test-results/globe-terrain/requests-et<n>.json` for sizing.
- Tests: `globe-terrain.smoke.spec.mjs` (heights without the extension;
  the look against the globe at noon, dusk and night; the data per
  descent at three error targets on a phone; the seam scan).
