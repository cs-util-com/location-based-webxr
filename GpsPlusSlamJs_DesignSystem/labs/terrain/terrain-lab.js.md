# terrain-lab.js: the terrain lab page

- Purpose: the terrain relief lab (terrain plan 2026-09-27-0605, milestones
  T1-T3): the Blue Ridge, the Alps, northern Germany or the viewer's GPS
  position from coarse Terrarium tiles in five
  styles (A "Pastel atlas", B "Natural colour", C "Globe blend", D "Swiss
  classic", E "Clay"), with the exaggeration slider (1-10, default 3), the
  "auto" switch (off by default; E = slider x factor, W = 0.43 x altitude),
  orbit and zoom, three camera presets and a scripted fly-in (600 km down
  to 20 km). Served at `/labs/terrain/`; deployed with the other labs by
  `build-lookdev.mjs`.
- How it works:
  - reads the hash (`terrain-params.js`); `loadRegion` resolves the
    place (`placeFor`, with the GPS fix a press of the pin found) and, on
    a place change, loads the new region without a reload: the mesh is
    hidden until its relief arrives, the far field starts over, and every
    answer for a superseded region is dropped (`run.regionId`); the tiles of the region
    (`regionTiles`, projected by the Osm library's `toWorldPixel` in its
    `enuFrameAt` frame) are FETCHED ON THE PAGE, each bounded by a 30 s
    timeout, a failure a gap, never a thrown batch;
  - copies of the bytes go to `terrain-worker.js`, transferred (the
    originals stay on the page for a rebuild when the sky view changes);
    its grids are packed
    (`packTerrain`, three's `toHalfFloat`) into the textures and material of
    `terrain-material.js`; the sky view arrives later and fills in;
  - the style's uniforms come from the hash through `applyStyle` (the
    place's latitude for B's lines, the region's land range for D's
    contrast);
  - the far field (style C, or `far=1`): the first time a style needs it,
    the globe's level-5 Blue Marble tiles over the region are fetched from
    `/globe-assets/` (the globe's own registry, `globe-sources.ts`),
    decoded without colour management and WITHOUT premultiplied alpha
    (`decodeRgba`: uploaded as the globe uploads them and read back
    through a WebGL2 framebuffer, so the water mask's pixels keep their
    colour; a 2D canvas returned them black and the relief drew lakes near
    black until 2026-10-01), and resampled onto the far-field grid
    (`terrain-far-field.js`). The decode NEEDS WebGL2, as the renderer
    does (three 0.185 has no WebGL1 path): its context lives on an
    unattached page canvas (Safari before 17 has no WebGL on an
    OffscreenCanvas) and is made again whenever it is lost; a context lost
    in the middle of one decode fails that load, said in the error line,
    and the next load makes a new one;
  - each frame: the camera (a preset, the hash's pose, the fly-in, or
    OrbitControls), the smoothed altitude, E, the slope boost and the far
    field's weights into the shader's uniforms, and the readout;
  - the imagery styles (globe round-5 plan §3.3, `imageryOn`): the same
    imagery the far field loads, resampled onto a 1 km albedo grid
    (`GLOBE_ALBEDO.side`) once per region, and for `globe-albedo`'s detail
    style B's cover luminance at every post, box-averaged over each
    imagery pixel's footprint at the albedo texels (`summedArea`,
    `boxMeanAt`), rebuilt with the relief or style B's lines; a new region
    resets both to `EMPTY_TEXTURE` (style B shows meanwhile); for
    `globe-bands` every imagery pixel whose footprint lies in the region,
    paired with the mean height over that footprint (with its global
    pixel indices for the sweep's block folds), once per relief, and the
    band ramp's LUT per `band`; for `globe-classes` the imagery's land
    colour and water share (`sampleImageryLand`) on the albedo texels, as
    two RGBA8 grids once per region (reset to `EMPTY_TEXTURE` by a new
    region, so style B shows meanwhile);
  - the key light each frame (globe round-5 plan §3.3): with `light` 1 the
    globe's sun, made by the globe lab's own call
    (`solarPosition(clock time, 0, 0)` from `/fw/geo/solar-position.js`)
    turned into the place's frame by `terrain-sun.js`'s
    `sunEnuFromGlobe`, on the globe lab's clock (`time=`, `timeScale=`,
    `/globe/globe-clock.js`); with `light` 0 the map light
    (`MAP_KEY_LIGHT`).
- The control plate and the hash (as in the globe lab): every
  `[data-hash-key]` control writes its key with `replaceState` and applies
  at once; `[data-preset]` buttons choose a camera (a second press of "Fly
  in" restarts it); a drag or a wheel writes `alt`/`tilt`/`head` once
  the damping has SETTLED (`poseSettled`: a frame moves the view by less
  than 0.005°), not at the gesture's `end`, when the damping still turns
  the camera. At that point the rest of the damping is applied at once and
  the pose it lands on is written, so the link reproduces where the view
  stopped. Every applied pose (preset, hash, fly-in) also ends any damping
  first, or it would drift after being set. The location pin (bottom right,
  the design system's locate atom): a PRESS asks for the position with the
  framework's `locateOnce` (15 s), never the page's load; a second press
  while it waits cancels, and a late answer is dropped; a failure names its
  fix (`labelFor`, `locateAdvice`) and leaves the place drawn; a fix loads
  the GPS place around it (`place=gps` in the hash, never the
  coordinates). The pin's line says "Found you ...: loading the terrain
  around you..." until that region's relief is built, and only then "The
  terrain around you (located to N m)."; a build with no data or a failed
  worker says it could not be drawn, and choosing another place first
  clears the line (`regionSettled`). A `place=gps` link, or choosing "My position" before any
  fix, draws nothing and says to press the pin. A style's own controls
  (`[data-styles]`) show only with that style; B's section says the fitted
  tree and snow lines. Another place loads its region in place (above).
  Keys: see `terrain-params.js.md`, plus `preset` and the
  camera triple.
- Feedback (the async-feedback rule): "Loading elevation tiles: n of 9",
  then "Computing relief...", then "Computing sky view..." (the terrain is
  already drawn), then nothing; "Loading Earth imagery..." while the far
  field loads, when nothing else is shown. Errors go to the red line: tiles
  that failed, worded by post count because that is what the hatch shows
  ("n of N height posts have no data (k of 9 elevation tiles could not
  load): they are hatched"), no data at all, a worker failure (an empty
  error message reads as "unknown error"), imagery that could not load
  (the far field then stays off, the near style drawn), a place or style
  this lab does not have.
- Credits: the full list from `terrain-credits.js`, in a `<details>` under a
  short line naming USGS and NOAA; with the far field on, the globe's Blue
  Marble credit joins it.
- Test hooks, `window.__terrainLab`: `ready`, `error`, `background`,
  `state()` (the applied hash, the style and its shader branch, the far
  field's state and weights, the light and the sun (`enu`, `elevationDeg`,
  `timeMs`, null with the map light), `sunIntensity`, the pixel ratio, the
  drawing `buffer`'s size and the camera's `fovDeg` (the comparison's pixel
  scale), `imageryOn`, `detail` and
  `globeColour` (`albedo`, `coarse`, `coarseMs`, `samples`, `samplesMs`, `classes` (globe-classes has its drawn region's grids), `bandsOn` (globe-bands has its drawn region's ramp), `clamp` (the share of land posts above the top band),
  `bands` with globe-bands), `band`, the land range, B's lines, the credits text,
  the region's centre, whether the GPS place awaits a fix, the pin's
  phase, E and its parts, W, the boost, the pose, the flight's samples, the tiles,
  bytes, datum, missing posts and tiles, the relief, the loading history
  and visibility, the error and readout text, and the textures' types),
  `project([x, y, z])`, `projectAll(points)` (one frame for many),
  `toEnu(lat, lng)`, `toLatLng(x, y)`,
  `fieldAt(x, y)` (the absolute height, gradient, small relief and relief spread the
  shader reads), `farAt(x, y)` (the far-field grid), `albedoAt(x, y)` (the imagery styles' albedo grid), `bandSweep(widths, blockPx = 1)` (globe-bands' sweep over the region's samples, its folds in blocks), `classAt(x, y)` (globe-classes' land colour and water share, bilinear as the shader reads them), `classSweep(settings?)` (globe-classes' class-threshold sweep, `CLASS_SWEEP` by default), `decodeRgba(blob)` (the page's imagery decode), `loseImageryContext()` (loses the decode's WebGL context, for the smoke's check that the next decode makes a new one), `imageryAt(lat, lng)`
  (the decoded imagery), `readPixels(points)` and
  `silhouette(columns, tolerance?)` (the first non-background row per
  column), `capture()` (the whole drawing buffer, row 0 at the bottom) and
  `frameCost(frames = 10)` (the ms of each frame after a warm-up, each
  forced by a one-pixel read: the comparison page's captures and cost, its
  mean and spread).
- Pixel ratio: the device's, capped at 2, unless `dpr` pins one (applied
  on load and on a hash change).
- Invariants & assumptions:
  - No tone mapping: the colours are the style's sRGB, as a printed map;
    only the far field is tone mapped, as the globe is.
  - One region at z8 (256 km) for every place and preset. The finer
    regions per preset (64 km at z10, 20 km at z12, plan §9 finding 8) are
    NOT built: T3 left them for a later milestone, so the low preset and
    the end of the fly-in show the z8 data magnified (about 480 m a texel).
  - Pan is off: the camera orbits the region's centre, so the hash's pose
    alone reproduces a view.
- Tests: `terrain.smoke.spec.mjs` (boot on the committed tiles with nothing
  leaving the machine and a positive, exact tile count; the loading line's
  sequence; a failing tile and all tiles failing; the auto switch; a flat
  tile unchanged at E 1, 2, 5 and 10; a tilted plane's colours unchanged at
  those E, read at the lifted points (E is not in the shading normal); a
  ridge's silhouette against E; the fly-in; the plate and the hash; a drag's
  pose written after the damping settles) and
  `terrain-styles.smoke.spec.mjs` (T2: every style against A, B's snow on
  the Alps at E 1, 2, 5, D's warm and cool slopes and terraces, E's
  saturation, C's far field against the grid and the imagery, a failed
  imagery load, the plate's styles) and `terrain-places.smoke.spec.mjs`
  (T3: every place on its own tiles and switched on the plate without a
  reload, Germany flat with sea posts, the GPS place granted, linked,
  denied, timed out and cancelled with the browser's geolocation mocked,
  the three presets framing every place). All share
  `terrain-smoke-helpers.mjs`. The modules beside it have their own
  `node --test` files.
