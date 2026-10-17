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
credit, fallback }` and `ReliefSourceConstants` `{ url, attribution }`.
  - `awsTerrariumRelief(constants)`, `mapterhornRelief(constants, fallback)`:
    frozen descriptions. The URL and the attribution text are the caller's
    (the Osm library's `TERRARIUM_*` / `MAPTERHORN_*` constants; one home,
    DEC-H3); the Globe package depends on neither the Osm library nor the
    framework. RangeError for a template without `{z}`/`{x}`/`{y}`, an
    empty attribution, or a fallback that has a fallback of its own.
  - `isTileTemplate(url)`: true for a string with `{z}`, `{x}` and `{y}`.
  - `reliefCredits(source)`: the source's credit, then its fallback's (its
    tiles may draw).
  - `reliefTerrainOptions(source)` -> `{ url, maxZoom, tileDimension,
fallbackUrl }`, spread into `createGlobeTerrain`, so an app cannot pair
    one source's url with another's tile size.
  - `RELIEF_MESH_SEGMENTS` 32 (the library's `MESH_SIZE`),
    `vertexSpacingM(level, lat)` (a Web Mercator tile's width at `lat`
    radians over 32 segments; RangeError for a level that is not an
    integer >= 0 or a latitude at a pole) and
    `meshLevelForSpacing(spacingM, lat)` (the coarsest level at or below
    the spacing; RangeError for a spacing that is not finite and > 0).
- Invariants & assumptions:
  - Both sources are Terrarium-encoded; Mapterhorn's are WebP, which the
    browser decodes like PNG.
  - Spacing is a property of the tree level alone: level 15 is about
    25.5 m at Munich (the library's default depth for z14), level 17
    about 6.4 m (the spikes' "L+3"); at 46.5 N level 17 is 6.58 m.
- Example:

  ```ts
  const aws = awsTerrariumRelief({
    url: TERRARIUM_URL_TEMPLATE,
    attribution: TERRARIUM_ATTRIBUTION,
  });
  const relief = mapterhornRelief(
    { url: MAPTERHORN_URL_TEMPLATE, attribution: MAPTERHORN_ATTRIBUTION },
    aws,
  );
  const terrain = createGlobeTerrain({
    ...reliefTerrainOptions(relief),
    meshMaxLevel: relief.maxZoom + 3,
    cache: reliefCacheBudget(relief.tileDimension, "desktop"),
    imagery,
    template,
    heightScale: 1,
  });
  renderCredits(reliefCredits(relief));
  ```

- Tests: `globe-relief-source.test.ts` (both descriptions, the credits and
  link, refusals, frozen results, the options, the spacings the spikes
  measured and a property test that the level is the coarsest at or below
  the spacing asked).
