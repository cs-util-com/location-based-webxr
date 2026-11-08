# building-geometry-model.js

- **Purpose:** the pure part of the building geometry lab: the buildings, their
  fixed cameras, the fixture each loads and the "today" picture of each camera.
- **Public API:**
  - `BUILDINGS`: `{ id, label, target, bugs, views }[]`; `target` is the
    outline whose first vertex is the scene origin; `views` maps a camera name
    to `{ pos, at, fov }` in scene metres (x east, y up, z south).
  - `fixtureUrl(id)`: the fixture's URL under the dev server's `/osm-lib/`
    route (the Osm package's `src/testdata/`); TypeError for an unknown id.
  - `todayShotUrl(id, view)`: the committed "today" PNG, or null.
  - `allShots()`: every `{ id, view }` in page order.
  - `PALETTES`: `["seeded", "class"]`, the `buildCity` colour palettes.
  - `parseParams(search)` / `searchFor(id, view, palette?)`: the query string
    and back; unknown values fall back to the first building, camera or
    palette, and the default palette stays out of the link.
- **Invariants:** every URL is a literal `new URL(..., import.meta.url)`, so the
  deploy's crawl (`build-lookdev.mjs`) copies the fixtures and pictures. The
  cameras of Heidelberg, Cologne and the four landmarks are the findings doc's;
  Tower Bridge and St Basil's were framed from their bounding boxes.
- **Tests:** `building-geometry-model.test.mjs` (every camera has its picture
  on disk, fallbacks, round trip, fixture URLs, the colour toggle).
