# terrain-params.js: place, field and hash parameters

- Purpose: the terrain lab's one state, the URL hash (terrain plan
  2026-09-27-0605 §4 "The control plate and the hash", DEC-TR-3/4, §9
  findings 8, 9, 14, 20), and the place and grid it draws.
- Public API:
  - `TERRAIN_PLACES.appalachians`: the Blue Ridge, centre 37.9° N, 79.2° W,
    a 256 km square (`halfExtentM` 128 km) at z8. The other three places of
    DEC-TR-3 come in T3.
  - `FIELD`: posts every 500 m (about the z8 texel), an 8 km padding ring,
    the relief sigma (2 km), the detail sigma (2 posts), the sky view's
    march (16 posts, 8 km: the padding covers it exactly). The hash sets the
    sky view's directions only, never the steps; 32 steps would need a 16 km
    ring (and, at z8, may reach a tenth tile row: check the fixtures).
  - The grid is equirectangular ENU: see `terrain-pipeline.js.md` for its
    residual against the true ground (about +-1.6 % east-west at the edges).
  - `fieldSpec(place)` -> `{ centre, zoom, halfExtentM, extentM, spacingM,
side }`: `extentM` includes the padding; `side` counts both edges.
  - `PARAMS`: every numeric key with its default and range: `exag` (1-10,
    2), `auto` (0/1, 0), `autoExp` (0.3), `tau` (0.5 s), `shade` (1),
    `boostExp` (0.3), `green` (0.7), `shadow` (0.45), `svf` (directions, 8;
    0 is off), `flyMs` (12 s).
  - `readTerrainParams(hash)`: every PARAMS value, `place`, `style`,
    `preset` (`top`, `oblique`, `low`, `fly` or null), `camera` (from
    `alt`, `tilt` and `head` when all three are valid, else null) and
    `notes` (what fell back, for the status line).
- Invariants: out of range, empty or malformed reads as the default, never
  NaN (a NaN uniform removes the draw silently). `place=gps` falls back to
  the Appalachians with a note; the hash never carries coordinates.
- Tests: `terrain-params.test.mjs`: the place, the field's posts, its
  padding against the sky-view march the lab runs and three blur
  sigmas, no hash key for the steps, the defaults, in-range values, five malformed values, the camera
  triple, presets, and the place and style fallbacks.
