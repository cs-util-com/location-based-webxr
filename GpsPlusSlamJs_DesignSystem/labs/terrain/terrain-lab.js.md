# terrain-lab.js: the terrain lab page

- Purpose: the terrain relief lab (terrain plan 2026-09-27-0605, milestone
  T1): the Blue Ridge from coarse Terrarium tiles in style A "Pastel atlas",
  with the exaggeration slider (1-10, default 2), the "auto" switch (off by
  default; E = slider x factor, W = 0.43 x altitude), orbit and zoom, three
  camera presets and a scripted fly-in (600 km down to 20 km). Served at
  `/labs/terrain/`; deployed with the other labs by `build-lookdev.mjs`.
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
  - each frame: the camera (a preset, the hash's pose, the fly-in, or
    OrbitControls), the smoothed altitude, E and the slope boost into the
    shader's uniforms, and the readout.
- The control plate and the hash (as in the globe lab): every
  `[data-hash-key]` control writes its key with `replaceState` and applies
  at once; `[data-preset]` buttons choose a camera (a second press of "Fly
  in" restarts it); a drag or a wheel writes `alt`/`tilt`/`head` once
  the damping has SETTLED (`poseSettled`: a frame moves the view by less
  than 0.005°), not at the gesture's `end`, when the damping still turns
  the camera. At that point the rest of the damping is applied at once and
  the pose it lands on is written, so the link reproduces where the view
  stopped. Every applied pose (preset, hash, fly-in) also ends any damping
  first, or it would drift after being set.
  Keys: see
  `terrain-params.js.md`, plus `preset` and the camera triple.
- Feedback (the async-feedback rule): "Loading elevation tiles: n of 9",
  then "Computing relief...", then "Computing sky view..." (the terrain is
  already drawn), then nothing. Errors go to the red line: tiles that
  failed, worded by post count because that is what the hatch shows ("n of
  N height posts have no data (k of 9 elevation tiles could not load): they
  are hatched"), no data at all, a worker failure (an empty error message
  reads as "unknown error"), a place or style this lab does not have yet.
- Credits: the full list from `terrain-credits.js`, in a `<details>` under a
  short line naming USGS and NOAA.
- Test hooks, `window.__terrainLab`: `ready`, `error`, `background`,
  `state()` (the applied hash, E and its parts, W, the boost, the pose, the
  flight's samples, the tiles, bytes, datum, missing posts and tiles, the
  relief, the loading history and visibility, the error and readout text,
  and the textures' types), `project([x, y, z])`, `toEnu(lat, lng)`,
  `readPixels(points)` and `silhouette(columns, tolerance?)` (the first
  non-background row per column).
- Invariants & assumptions:
  - No tone mapping: the colours are the style's sRGB, as a printed map.
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
  pose written after the damping settles). The modules beside it have their own
  `node --test` files.
