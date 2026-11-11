# building-geometry.js

- **Purpose:** the building geometry lab's page. It shows one landmark from one
  fixed camera twice: the picture captured before the OSM geometry fixes
  ("Today") next to the library's live render from the same camera ("Now"), so
  the owner confirms each fix by eye. Findings and bug numbers:
  `GpsPlusSlamJs_Docs/docs/2026-11-07-0920-osm-building-geometry-bugs-findings.md`
  (private docs repo).
- **Public API:** `startBuildingGeometry()` runs once on import and publishes
  `window.__buildingGeometry = { ready, error, building, view, palette,
roofs, triangles }`
  at once; `ready` turns true after the first frame, `error` carries the stack
  of a failure, which also shows on the page. `triangles` counts the building
  meshes' triangles within the window.
- **Query string:** `building` and `view` pick the scene and camera (see
  `building-geometry-model.js`); `palette=class` draws the class colours
  instead of the seeded palette (the "Farben: Palette / Klassen" toggle, the
  only user of `buildCity`'s `palette: "class"`, city objects plan M7 review
  MINOR 3); `roofs=off` draws the flat tops the library drew before its
  invented roofs (the "Dächer: erfunden / flach" toggle, the roofs'
  before and after; `inventedRoofs: false` to `buildCity`); `capture` hides everything but the live
  canvas, which is how the "today" pictures were taken.
- **Invariants:**
  - The scene's origin is the first vertex of the building's `target` outline,
    the frame the findings doc's cameras are written in (x east, y up, z
    south).
  - The drawing buffer is always 800 x 600 at pixel ratio 1, the size of the
    "today" pictures, so the two halves frame alike at any screen size.
  - The city is `buildCity` within 400 m, drawn with `buildingObjects`: the
    consumers' own path, so a fix in either shows here. Its `window` is the
    fixture's `bbox` (the fetched box, required since objects M2a).
  - Plain lights and no tone mapping: the page judges geometry and colour, not
    the look (the city look lab is where looks are compared).
  - **Known gap (r1162):** since r1158 the building colours are LINEAR, so
    "Now" reads up to a fifth darker than the "today" pictures captured
    before, from the colour change alone, not from geometry. The lights here
    were not raised (the consumers raised theirs); a raise needs a factor
    measured against the "today" pictures. Filed as a follow-up.
  - Controls are links; changing building or camera reloads the page.
- **Capturing "today" again** (only to add a camera, and only from a checkout
  of the commit before the fixes): serve the package (`PORT=4820
HOST=127.0.0.1 node serve.mjs`), open each `?building=<id>&view=<view>&capture=1`
  in headless Chromium with SwiftShader at a 900 x 700 viewport, wait for
  `__buildingGeometry.ready`, screenshot the `canvas` element, and compress it
  to a 128-colour PNG (sharp, `palette: true`) under `today/`.
- **Tests:** `3d/pages.fast.spec.mjs` opens the default view (fast tier);
  `building-geometry.smoke.spec.mjs` opens every building and camera and checks
  its "today" picture loads (full tier); `building-geometry-model.test.mjs`
  covers the pure part.
- **Attribution:** "Map data (c) OpenStreetMap contributors, ODbL" is always
  visible under the pictures.
