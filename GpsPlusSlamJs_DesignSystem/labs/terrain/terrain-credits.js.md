# terrain-credits.js: the elevation sources' credits

- Purpose: the credits the AWS Terrain Tiles ask for (terrain plan
  2026-09-27-0605 §3; research 2026-09-27-0600 §5.4), shown on the lab's
  credits line.
- Public API:
  - `TERRAIN_CREDIT_SHORT`: the line over the canvas.
  - `TERRAIN_CREDITS`: tilezen/joerd `docs/attribution.md`'s list "Required
    attribution when using Mapzen's hosted service", VERBATIM (commit
    d8f587b7, 2017-11-14, the file's last change; read 2026-09-28): its
    semicolons and its en dashes as the source has them. The AWS Terrain
    Tiles are that hosted service's tiles, which is why "Mapzen" leads the
    list. The en dashes are a quoted credit, not our prose (the repo's rule
    is about em dashes in what we write).
  - `TERRAIN_CREDIT_LINKS`: the registry's dated citation, and joerd's page
    at that commit.
- Invariants: the Osm library's `TERRARIUM_ATTRIBUTION` names none of these
  sources; that gap is its own fix (plan §8), and until it lands this list
  is the complete one. Text only: the page renders it with `textContent`.
- Tests: `terrain-credits.test.mjs`: Mapzen, the USGS, NOAA, Copernicus,
  Kartverket and the registry are named; the short line points to USGS and
  NOAA; links are https; the list equals joerd's block (pasted in the test
  as fetched) bullet for bullet; the joerd link names the commit.
