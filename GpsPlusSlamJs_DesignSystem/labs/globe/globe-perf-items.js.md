# labs/globe/globe-perf-items.js - editor-style items for the fixed-view sweep

- Purpose: what a tour editor draws per station, for the recorder's
  fixed-view sweep (`globe-perf-views.js`): a pole, a ground ring, a label
  sprite, a sign face and its back, each with its own geometry, material
  and canvas texture (as the editor's station marks are built, so the
  draw calls and uploads are an editor's). Loaded by `globe-lab.js` only
  with `#perf=1`.
- Public API:
  - `PERF_ITEM`: the sizes (m): a 2 m pole, a 1.2 m ring, a 0.8 m sign, a
    1.6 m label.
  - `createPerfItems({ parent, ellipsoid, groundM, eyeItems })` ->
    `{ set(offsets, place), count, inView(camera), probe(...) }`. `set` disposes every item and builds
    one per offset (metres east and north of `place`), each in its own
    east-up-south frame on the ellipsoid, raised to `groundM(at)`, as a
    child of `parent` (the globe's Earth-centred group, so a frame recentre
    moves nothing); `set([])` removes them all. Each is registered in
    `eyeItems` (`perf-item-<k>`) with a bounding sphere in world
    coordinates, so the eye camera's near plane follows them.
  - `inView(camera)` -> how many items have their pole's middle inside
    `camera`'s frustum now (0 without items): the recorder records it
    per run, since a portrait street view sees only some of them.
  - `probe(k, camera, groundOf)` -> `{ inView, footOverGroundM }` or null
    without item `k`: whether its pole's middle is inside `camera`'s
    frustum, and its foot's height over `groundOf(place)` (negative when
    the drawn ground rose over it). The smoke reads it through
    `window.__globeLab.perfItem(k)`, so a sweep that measured buried or
    unseen items fails.
- Invariants & assumptions: the spheres are taken through the parent's
  matrix of the last frame, so they are right until the frame recentres
  (the recorder places the camera and never recentres). The lab's
  `clearEyeItems` smoke hook assumes meshes and must not be used while
  these are registered. The items are placed once per held run, after
  the view's settle, so they stand on the relief as refined then; a
  later refinement can move the ground under them (the smoke checks
  item 0 at street level).
- Tests: `globe-perf-views.smoke.spec.mjs` (registered while held, item 0
  in view and on the ground at street level, removed after the sweep).
