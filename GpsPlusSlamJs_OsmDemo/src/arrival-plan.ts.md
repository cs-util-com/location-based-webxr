# arrival-plan.ts - what OsmDemo loads when it opens at a position

- Purpose: the plan the globe's arrival prefetch warms (round-5 plan
  `2026-10-01-0945-globe-round-5-fly-in-and-terrain-blend-plan.md` §3.6,
  DEC-GL5-8): exactly what OsmDemo fetches at arrival with its default
  settings. Pure; no network.
- Public API:
  - `arrivalPlanFor(target)` -> `{ position, overpassTiles, demUrls }`:
    - `position`: the target at five decimals, as the globe's hand-over URL
      writes it and OsmDemo's `parseStartPosition` reads it back (a target
      a hair across a cell edge would otherwise plan the neighbouring tile);
    - `overpassTiles`: the res-7 tiles of every scored ring,
      `fetchTilesForScoreWorkingSet(chunk, r)` for each `r` of
      `PROGRESSIVE_RADII`, deduplicated (1-3 tiles, about 21 MB each when
      cold). Not the six background neighbours: OsmDemo's own prefetch
      queue pulls those after arrival;
    - `demUrls`: every z13 tile URL the fresh terrain field requests for
      the arrival window (`TERRAIN_EXTENT_M` through `terrainWindowFor` and
      `latticeWindow`), for both arms of the DEM race
      (`DEM_URL_TEMPLATES.preferred` Mapterhorn, `.fast` AWS). The URL is
      the cache key.
  - RangeError for a target that is not a finite latitude in [-90, 90] and
    longitude in [-180, 180].
- Invariants & assumptions:
  - Nothing here is a second copy of OsmDemo's arithmetic: the ring radii,
    the tile function, the window extent, the lattice window, the zoom and
    the URL templates are the modules OsmDemo itself uses.
  - The DEM tiles come from the provider's own round trip
    (`fromWorldPixel`, then `toTilePixel`), per axis: longitude depends only
    on x and latitude only on y, so two passes of about 300-1,000 pixels
    replace the 0.2-1 million lattice posts the field samples.
  - It assumes the hand-over opens OsmDemo in its default state: the
    desktop terrain window, the default rings. The rule table
    (`rules/v1/table.csv`, TTL-cached, small) is not planned.
- Examples:

  ```ts
  const plan = arrivalPlanFor({ lat: 50.9413, lng: 6.9583 });
  // Cologne: one Overpass tile, 18 DEM URLs (9 tiles x 2 sources)
  ```

- Tests: `arrival-plan.test.ts` compares the plan with OsmDemo's real
  machinery: a `DemoPipeline` run through every ring with a recording
  source (the Overpass tiles), and `createDemProvider` + `createTerrainField`
  with a recording fetch (the DEM URLs), at six fixed places (equator, 64° N,
  the southern hemisphere, the Alps box, New York, Cologne) and at random
  places (property tests); plus the position against `parseStartPosition`
  and the RangeErrors.
