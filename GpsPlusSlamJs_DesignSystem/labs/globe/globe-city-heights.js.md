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
  - One template, never a race between sources: the city reads the
    relief's SOURCE, at the source's global zoom (12), so a single
    template suffices for a source with gaps (Mapterhorn's fine zooms).
  - **The city does not read exactly what the relief draws** (G1 review
    L5). With Mapterhorn the relief draws z14 where a national model
    exists (z12 elsewhere), the city reads z12 everywhere. z12 is
    Copernicus GLO-30 resampled, z14 the national LiDAR model; the G0
    spikes put AWS 5-11 m off the national models in towns, and z12 of
    Mapterhorn is not AWS, so the offset between the city's ground and the
    drawn ground at z14 is UNMEASURED. Measure it (city base heights
    against `finestElevationAt` on the relief at a few towns) before
    claiming the city stands on the drawn ground with Mapterhorn. With AWS
    both are z12 and the same numbers. What the reader does where the
    source answers 404 at z12 (Mapterhorn over deep ocean) was not checked.
- Example:

  ```js
  const plan = cityDataPlan(target, {
    heights: cityHeights(12, MAPTERHORN_URL_TEMPLATE),
  });
  ```

- Tests: `globe-city-heights.test.mjs` (the template carried through, zoom
  and template refusals). The city smokes (`globe-city.smoke.spec.mjs`)
  run the worker with it on routed heights.
