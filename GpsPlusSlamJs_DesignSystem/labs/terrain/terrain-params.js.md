# terrain-params.js: place, field and hash parameters

- Purpose: the terrain lab's one state, the URL hash (terrain plan
  2026-09-27-0605 §4 "The control plate and the hash", DEC-TR-2/3/4, §9
  findings 8, 9, 11, 14, 20), and the place and grid it draws.
- Public API:
  - `TERRAIN_PLACES`: each a 256 km square (`halfExtentM` 128 km) at z8:
    - `appalachians`: the Blue Ridge, centre 37.9° N, 79.2° W;
    - `alps`: the central Alps, centre 46.56° N, 9.14° E (the middle of z8
      tile 134/90, so the region and its padding fit in 3 x 3 tiles),
      7.4-10.9° E and 45.3-47.8° N, Monte Rosa and the Bernese Oberland to
      the Bernina. Added in T2 because style B's snow is checked on it.
    - `germany`: northern Germany, centre 53.75° N, 9.14° E (the middle of
      tile 134/82, 3 x 3 tiles), 7.1-11.2° E and 52.5-55.0° N: the lower
      Elbe, Hamburg, the North Sea coast and Schleswig-Holstein; the flat
      place (T3), with sea posts.
  - `GPS_PLACE` (`"gps"`) and `placeFor(id, fix)`: a committed place by
    id, or the GPS place (the same 256 km z8 region) around a fix, or null
    for the GPS place before any fix (the page then waits for a press).
  - `FIELD`: posts every 500 m (about the z8 texel), an 8 km padding ring,
    the relief sigma (2 km), the detail sigma (2 posts), the sky view's
    march (16 posts, 8 km: the padding covers it exactly). The hash sets the
    sky view's directions only, never the steps; 32 steps would need a 16 km
    ring (and, at z8, may reach a tenth tile row: check the fixtures).
  - The grid is equirectangular ENU: see `terrain-pipeline.js.md` for its
    residual against the true ground (about +-1.6 % east-west at the edges).
  - `fieldSpec(place)` -> `{ centre, zoom, halfExtentM, extentM, spacingM,
side }`: `extentM` includes the padding; `side` counts both edges.
  - `PARAMS`: every numeric key with its default and range:
    - the view: `exag` (1-10, 2), `auto` (0/1, 0), `autoExp` (0.3), `tau`
      (0.5 s), `shade` (1), `boostExp` (0.3), `svf` (directions, 8; 0 is
      off), `flyMs` (12 s);
    - the look: `green` (0.7, styles A and C), `shadow` (0-1; with no key,
      the style's own: A and C 0.45, B 0.65, D 0.6, E 0.55);
    - style B: `tree` and `snow` (line offsets, -1500 to 1500 m, 0),
      `aspect` (poleward snow, 0-600 m, 250), `rock` (28-50°, 38), `lift`
      (0-0.4, 0.2), `snowMask` (0/1, 0: the mask instead of the colours);
    - style D: `exposure` (0-0.7, 0.35), `contrast` (the lowlands' share,
      0.2-1, 0.4);
    - the far field: `far` (0/1, 0), `farHigh` (100-5000 km, 1500) and
      `farLow` (10-2000 km, 300).
  - `STYLE_SHADOW`: each style's own shading strength.
  - `readTerrainParams(hash)`: every PARAMS value, `place`, `style` (one of
    `terrain-styles.js`'s `TERRAIN_STYLES`), `farOn` (style C, or `far=1`),
    `preset` (`top`, `oblique`, `low`, `fly` or null), `camera` (from
    `alt`, `tilt` and `head` when all three are valid, else null) and
    `notes` (what fell back, for the status line).
- Invariants: out of range, empty or malformed reads as the default, never
  NaN (a NaN uniform removes the draw silently). A `farLow` at or above
  `farHigh` falls back to both defaults with a note. An unknown place
  falls back to the Appalachians with a note, an unknown style to style A.
  Places and styles are the tables' OWN keys (`Object.hasOwn`): an `in`
  lookup also accepted `toString` or `constructor`, which reached the
  region and the shader as functions (review 2026-09-29 B1). `place=gps` is read as it
  is; the hash never carries coordinates (plan §9 finding 20), so a link
  to it needs a press of the pin to draw anything.
- Tests: `terrain-params.test.mjs`: the places and `placeFor` (with and
  without a fix, an invalid fix, `place=gps` without a note), the field's posts, its
  padding against the sky-view march the lab runs and three blur sigmas, no
  hash key for the steps, the defaults, in-range values, five malformed
  values, the camera triple, presets, the place and style fallbacks (inherited property names included), every
  style, each style's own shadow and the override, the far field's switch
  and its altitude check. `terrain-pipeline.test.mjs` holds each place's
  tile set to its committed fixtures.
