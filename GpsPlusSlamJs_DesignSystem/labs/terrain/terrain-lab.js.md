# terrain-lab.js: the terrain lab page

- Purpose: the terrain relief lab (terrain plan 2026-09-27-0605, milestones
  T1-T2): the Blue Ridge or the Alps from coarse Terrarium tiles in five
  styles (A "Pastel atlas", B "Natural colour", C "Globe blend", D "Swiss
  classic", E "Clay"), with the exaggeration slider (1-10, default 2), the
  "auto" switch (off by default; E = slider x factor, W = 0.43 x altitude),
  orbit and zoom, three camera presets and a scripted fly-in (600 km down
  to 20 km). Served at `/labs/terrain/`; deployed with the other labs by
  `build-lookdev.mjs`.
- How it works:
  - reads the hash (`terrain-params.js`); the tiles of the region
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
    the globe's level-4 Blue Marble tiles over the region are fetched from
    `/globe-assets/` (the globe's own registry, `globe-sources.ts`),
    decoded without colour management, and resampled onto the far-field
    grid (`terrain-far-field.js`);
  - each frame: the camera (a preset, the hash's pose, the fly-in, or
    OrbitControls), the smoothed altitude, E, the slope boost and the far
    field's weights into the shader's uniforms, and the readout.
- The control plate and the hash (as in the globe lab): every
  `[data-hash-key]` control writes its key with `replaceState` and applies
  at once; `[data-preset]` buttons choose a camera (a second press of "Fly
  in" restarts it); a drag or a wheel writes `alt`/`tilt`/`head` once
  the damping has SETTLED (`poseSettled`: a frame moves the view by less
  than 0.005°), not at the gesture's `end`, when the damping still turns
  the camera. At that point the rest of the damping is applied at once and
  the pose it lands on is written, so the link reproduces where the view
  stopped. Every applied pose (preset, hash, fly-in) also ends any damping
  first, or it would drift after being set. A style's own controls
  (`[data-styles]`) show only with that style; B's section says the fitted
  tree and snow lines. Another place reloads the page (the hash is the
  whole state). Keys: see `terrain-params.js.md`, plus `preset` and the
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
  field's state and weights, the land range, B's lines, the credits text,
  E and its parts, W, the boost, the pose, the flight's samples, the tiles,
  bytes, datum, missing posts and tiles, the relief, the loading history
  and visibility, the error and readout text, and the textures' types),
  `project([x, y, z])`, `projectAll(points)` (one frame for many),
  `toEnu(lat, lng)`, `toLatLng(x, y)`,
  `fieldAt(x, y)` (the absolute height, gradient and small relief the
  shader reads), `farAt(x, y)` (the far-field grid), `imageryAt(lat, lng)`
  (the decoded imagery), `readPixels(points)` and
  `silhouette(columns, tolerance?)` (the first non-background row per
  column).
- Invariants & assumptions:
  - No tone mapping: the colours are the style's sRGB, as a printed map;
    only the far field is tone mapped, as the globe is.
  - One region at z8 (256 km); the finer regions per preset (64 km at z10,
    20 km at z12, plan §9 finding 8) come with T3, so the low preset and the
    end of the fly-in show the z8 data magnified.
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
  imagery load, the plate's styles). Both share
  `terrain-smoke-helpers.mjs`. The modules beside it have their own
  `node --test` files.
