# globe-city-heights.ts

- Purpose: the heights the globe's city stands on are the relief's own
  source at the relief's zoom (globe city plan 2026-10-05-0040 §12.4 R13).
  Since G1 step 1d (tour editor plan
  `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md` §13, primary
  repo) the source comes with each load instead of a template fixed in the
  worker: with a Mapterhorn relief the city otherwise stood on AWS heights,
  up to 12 m apart in towns (the G0 spikes). Moved out of the globe lab
  (`labs/globe/globe-city-heights.js`) as a pure refactor
  (editor-on-the-full-globe plan
  `2026-10-27-1850-editor-on-the-full-globe-plan.md`, primary repo, the
  city slice).
- Public API:
  - `CITY_HEIGHTS_ZOOM` `{ min: 1, max: 15 }` (frozen): the zooms the Osm
    library's reader takes.
  - `CityHeightsSpec` `{ urlTemplates: string[]; zoom: number }`.
  - `cityHeights(zoom, url)` -> `{ urlTemplates: [url], zoom }`, the
    library's heights spec for `cityDataPlan`. RangeError for a zoom that
    is not an integer 1-15 or a url without `{z}`, `{x}` and `{y}` (a
    non-string included: the worker's message is data from the page).
- Invariants & assumptions:
  - Pure, no imports: the lab's city worker loads it through the worker
    view (`/w/globe/globe-city-heights.js`, the Globe route with its types
    stripped), `globe-city.ts` checks a template with it, and the tests
    import it alike.
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

  ```ts
  const plan = cityDataPlan(target, {
    heights: cityHeights(12, MAPTERHORN_URL_TEMPLATE),
  });
  ```

- Tests: `globe-city-heights.test.ts` (the template carried through, zoom
  and template refusals), `globe-city-heights.property.test.ts` (every
  zoom 1-15 and token template through unchanged, everything else
  refused). The city smokes (`labs/globe/globe-city.smoke.spec.mjs` in the
  design system) run the worker with it on routed heights.
