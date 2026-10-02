# globe-terrain-lab.js - the relief carrier, side by side with the globe

- Purpose: round-5 plan 2026-10-01-0945 §8 DEC-GL5-9, F1a (the decided
  choice of the tile library's terrain tiles as the relief): the carrier
  from `/globe/globe-terrain.js` drawn with the globe's own look and sun,
  or the globe's own surface at the same view, so the smokes hold the
  carrier to the globe. It is a measuring page, not the flight. Results:
  `GpsPlusSlamJs_Docs/docs/2026-10-02-0307-globe-f0-frame-and-carrier-spike-results.md`
  and the round-4 results record.
- Hash parameters: `carrier` (`terrain`, the default, or `globe`); `alt`
  (km above the target, default 150), the camera looking north and down
  at 45 degrees, or straight down with `nadir=1`; `lat`, `lng` (the
  target, default 46.5 N 9.0 E); `time` (an hour UTC on the 2026 March
  equinox, default 11.4: the sun overhead at 9 E); `heightScale` (default
  1); `errorTarget` (default `GLOBE_TERRAIN.errorTarget`, 2, the carrier's,
  picked by the look; the library's own is 1);
  `heights` (`synthetic`, the default: Terrarium tiles generated in the
  page, a 1 km plateau with ridges of 5-50 km, 0-2,200 m, so nothing
  leaves 127.0.0.1; or `terrarium`, the live AWS tiles from the Osm
  library's `TERRARIUM_URL_TEMPLATE`, with its credit shown); `sea` (m,
  lowers the synthetic heights: a coast for the bathymetry check);
  `hideFloatLinear=1` (hides OES_texture_float_linear from the page, as
  on a device without it); `heightFormat=r32f` (undoes the half-float
  patch, for the R16F against R32F shading comparison); `debug=height`
  (each pixel the drawn height in two channels, v = (h + 1,000 m) x 8,
  red its high byte and green its low byte, 0.125 m a step from -1,000
  to 7,191 m; the background magenta, for the seam scan);
  `seamControl=1` (every tile's heights offset by its own random amount,
  up to 50 m either way: the seam scan's positive control).
- Test API, `window.__terrainCarrier`: `ready`, `error`, `look` (the
  parameters), `setAlt(km)`, `settled()` (all loaded, nothing queued,
  downloading or parsing), `frameCost(frames)` (mean ms, each frame
  finished by a one-pixel read), `state()` (`visibleTiles`,
  `visibleByLevel` (the library's depth counts its root: level = depth -
  1), `triangles`, `heightRequests` (every height tile asked for,
  `z/x/y`), `syntheticBytes`, `litTiles`, `floatLinear`,
  `drawingBuffer`), `probeHeight()` (the first tile's height texture as
  the GPU samples it midway between two texels, against the CPU value:
  `{ internalFormat, cpuMidwayM, gpuMidwayM }`), `readPixels(points)`,
  `seamScan(fromY, thresholdsM)` (every pixel below `fromY` of a
  `debug=height` frame: the cracks showing the background, the drawn
  height range in metres, and the steps over each threshold between a
  pixel and its right and lower neighbours).
- Invariants & assumptions:
  - The carrier wears the globe's template and reads the globe's uniforms
    (`createGlobeSurface().template`); the globe's tiles are hidden and
    not updated in carrier mode, its sun light still lights the scene.
  - Both carriers are drawn in ECEF here.
  - The synthetic tiles' PNG sizes are not representative of real
    Terrarium tiles: the data smoke writes the requested tiles to
    `test-results/globe-terrain/requests-<heights>-et<n>.json`, and
    `terrarium-bytes.mjs` sums their real sizes.
- Tests: `globe-terrain.smoke.spec.mjs` (heights without the extension;
  the look against the globe at the 150 km hold by day, dusk, night and
  at 70 N, held to its bound; from 1,000 and 5,000 km measured only, since
  the globe's own surface draws there (the altitude band); and the
  relief showing at E 3; the seam scan with
  its positive control; the coast at E 3; the data per descent; and, with
  `GLOBE_TERRAIN_LIVE=1`, the real-tile seam scan, R16F against R32F at a
  low sun above 3,000 m, and the descent and error target on real
  heights).
