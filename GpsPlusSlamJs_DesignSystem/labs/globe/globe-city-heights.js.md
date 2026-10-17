# globe-city-heights.js

- Purpose: the heights the globe's city stands on are the relief's own
  source at the relief's zoom (globe city plan 2026-10-05-0040 §12.4 R13).
  Since G1 step 1d (tour editor plan
  `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md` §13, primary
  repo) the source comes with each load instead of a template fixed in the
  worker: with a Mapterhorn relief the city otherwise stood on AWS heights,
  up to 12 m apart in towns (the G0 spikes).
- Public API:
  - `CITY_HEIGHTS_ZOOM` `{ min: 1, max: 15 }`: the zooms the Osm library's
    reader takes.
  - `cityHeights(zoom, url)` -> `{ urlTemplates: [url], zoom }`, the
    library's heights spec for `cityDataPlan`. RangeError for a zoom that
    is not an integer 1-15 or a url without `{z}`, `{x}` and `{y}`.
- Invariants & assumptions:
  - Pure, no imports: the worker (through the worker view), the page's
    `globe-city.js` (whose boot graph stays free of the Osm library) and
    node tests import it alike.
  - One template, never a race between sources: the city must read what
    the relief draws. A source with gaps (Mapterhorn's fine zooms) is read
    at its global zoom (12), so a single template suffices.
- Example:

  ```js
  const plan = cityDataPlan(target, {
    heights: cityHeights(12, MAPTERHORN_URL_TEMPLATE),
  });
  ```

- Tests: `globe-city-heights.test.mjs` (the template carried through, zoom
  and template refusals). The city smokes (`globe-city.smoke.spec.mjs`)
  run the worker with it on routed heights.
