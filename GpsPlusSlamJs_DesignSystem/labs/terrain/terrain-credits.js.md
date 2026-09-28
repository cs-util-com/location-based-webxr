# terrain-credits.js: the elevation sources' credits

- Purpose: the credits the AWS Terrain Tiles ask for (terrain plan
  2026-09-27-0605 §3; research 2026-09-27-0600 §5.4), shown on the lab's
  credits line.
- Public API: `TERRAIN_CREDIT_SHORT` (the line over the canvas),
  `TERRAIN_CREDITS` (the required list as tilezen/joerd
  `docs/attribution.md` gives it for the hosted tiles, read 2026-09-27, its
  en dashes written as hyphens), `TERRAIN_CREDIT_LINKS` (the registry's
  dated citation and the attribution page).
- Invariants: the Osm library's `TERRARIUM_ATTRIBUTION` names none of these
  sources; that gap is its own fix (plan §8), and until it lands this list
  is the complete one. Text only: the page renders it with `textContent`.
- Tests: `terrain-credits.test.mjs`: Mapzen, the USGS, NOAA, Copernicus,
  Kartverket and the registry are named; the short line points to USGS and
  NOAA; links are https.
