# globe-relief-source.ts

- Purpose: the relief's height sources described for the globe (tour
  editor plan `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md`
  §13, G1 step 2; G0 spikes `2026-10-17-2320-tour-editor-3d-g0-spikes-results.md`
  Q1, both in the primary repo's `GpsPlusSlamJs_Docs/docs/`): AWS Terrarium
  (the globe's default) and Mapterhorn (what the 3D editor draws: within
  0.5 m of the national LiDAR models at 96-100 % of points, where AWS is
  5-11 m off in towns), and the arithmetic from a vertex spacing to the
  relief tree's level.
- Public API:
  - `RELIEF_SOURCES`: per source its `id`, `maxZoom` (AWS 12, Mapterhorn
    14), `globalZoom` (12 for both: Mapterhorn's z13 and finer exist only
    where a national model does), `tileDimension` (256 / 512), the credit's
    `short` name and `href` (Mapterhorn's: `https://mapterhorn.com/attribution`,
    the link its own TileJSON gives).
  - `GlobeReliefSource` `{ id, url, maxZoom, globalZoom, tileDimension,
credit, sourceCredits, ancestorFallback }` and `ReliefSourceConstants`
    `{ url, attribution }`.
  - Copernicus GLO-30's credit (a module constant, reached through
    `reliefCredits`): the line of the dataset Mapterhorn draws
    from everywhere (G1 review L1), worded as Mapterhorn's attribution
    list gives it (`https://download.mapterhorn.com/attribution.json`,
    the data behind `https://mapterhorn.com/attribution`, read
    2026-10-18): "© DLR e.V. 2010-2014, Airbus Defence and Space GmbH
    2014-2018, provided under COPERNICUS by the European Union and ESA.
    All rights reserved.", linked to the COP-DEM collection page.
  - `awsTerrariumRelief(constants)`, `mapterhornRelief(constants)`:
    frozen descriptions. The URL and the attribution text are the caller's
    (the Osm library's `TERRARIUM_*` / `MAPTERHORN_*` constants; one home,
    DEC-H3); the Globe package depends on neither the Osm library nor the
    framework. RangeError for a template without `{z}`/`{x}`/`{y}` or an
    empty attribution. AWS has no source credits and no ancestor
    fallback (it has every tile to z12); Mapterhorn has the Copernicus
    line and `ancestorFallback: true` (G1 review M2: where it answers
    404, its own nearest ancestor, cropped and upsampled, instead of a
    second source; see `globe-relief-fallback.ts.md`).
  - `isTileTemplate(url)`: true for a string with `{z}`, `{x}` and `{y}`.
  - `reliefCredits(source)`: the source's credit, then its source
    credits.
  - `reliefTerrainOptions(source, device)` -> `{ url, maxZoom,
tileDimension, ancestorFallback, device, cache }`, spread into
    `createGlobeTerrain`, so an app cannot pair one source's url with
    another's tile size, nor a 512 px source with the 256 px budget (G1
    review M1: set up the obvious way, Mapterhorn stalled again in 64
    MiB). `cache` is `reliefCacheBudget(tileDimension, device)`; the
    device class is required (RangeError without one).
  - `vertexSpacingM(level, lat)` (a Web Mercator tile's width at `lat`
    radians over the mesh's 32 segments, the library's `MESH_SIZE`;
    RangeError for a level that is not an
    integer >= 0 or a latitude at a pole) and
    `meshLevelForSpacing(spacingM, lat)` (the coarsest level at or below
    the spacing; RangeError for a spacing that is not finite and > 0).
- Invariants & assumptions:
  - Both sources are Terrarium-encoded; Mapterhorn's are WebP, which the
    browser decodes like PNG.
  - Attribution, what is and is not shown: Mapterhorn's own line and
    Copernicus GLO-30's. Mapterhorn's list names about 150 further
    sources (the national models of the regions it covers at z13 and
    finer), each with its own licence text. Which of them a view draws
    depends on where it is; showing the lines of the regions in view is
    parked for G2 (the credits line has the link to the full list).
  - Spacing is a property of the tree level alone: level 15 is about
    25.5 m at Munich (the library's default depth for z14), level 17
    about 6.4 m (the spikes' "L+3"); at 46.5 N level 17 is 6.58 m.
- Example:

  ```ts
  const relief = mapterhornRelief({
    url: MAPTERHORN_URL_TEMPLATE,
    attribution: MAPTERHORN_ATTRIBUTION,
  });
  const terrain = createGlobeTerrain({
    ...reliefTerrainOptions(relief, "desktop"),
    meshMaxLevel: relief.maxZoom + 3,
    imagery,
    template,
    heightScale: 1,
  });
  renderCredits(reliefCredits(relief));
  ```

- Tests: `globe-relief-source.test.ts` (both descriptions, the credits,
  Copernicus's line and the links, refusals, frozen results, the options
  with the device's cache budget and the refusal without a device, the spacings the spikes
  measured and a property test that the level is the coarsest at or below
  the spacing asked).
