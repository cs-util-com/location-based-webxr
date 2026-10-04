# globe-handover.ts - the link from the globe to the city

- Purpose: round-2 plan 2026-09-26-2055 DEC-FB2-3, M3g. The pin's dive ends
  by opening the OSM demo at the user's position: a quick cut (the seamless
  descent is the globe plan's phase 5). This module builds that link.
- Public API:
  - `OSM_HANDOVER` - the demo's side of the contract, written out (this
    package does not depend on the demo), each copy held to the demo's
    source by `tests/repo-config/globe-handover-contract.test.js`:
    `maxCameraDistanceM` 4800 (its `url-state.ts` `MAX_DISTANCE_M`; a larger
    `cdist` is refused and the demo opens its default view), `farPlaneM`
    4800 (`FAR_PLANE_M` 2400 x `DEFAULT_RENDER_MULTIPLIER` 2, the far plane
    it boots with), `fogNearRatio` 0.66 (`FOG_NEAR_RATIO`: its linear fog
    runs from 0.66 of the far plane, 3168 m, to the far plane) and
    `minSunElevationDeg` -6 (`SUN_CLOCK.minElevationDeg`, civil twilight,
    below which its sky does not render reliably). And the lab's choices:
    `tileHalfM` 1300 (about half the span of the tile the demo fetches, an
    H3 res-7 cell's bounding box: 2,465 x 2,554 m at Cologne, 2,564 x
    2,744 m at New York, 2,188 x 2,565 m at 0°N, 2,291 x 2,198 m at 60°N)
    and `cameraDistanceM` 1800, the `cdist` handed over.
  - **The hand-over distance, and why not the demo's maximum** (milestone
    review of the pin, M1; a deviation from round-2 M3g's "cdist at its
    maximum"). OsmDemo places its camera `cdist` metres from the spot
    along its view axis. At 4800 m the spot sat exactly at the far plane,
    fully fogged, and the fetched tile beyond it lay in the fog. The
    sweep, worked from the numbers above (a level view is the worst case:
    the tile's far side at `d + tileHalfM`; the fog factor is linear from
    3168 to 4800 m; the width seen at the spot's depth at the demo's 55°
    vertical field of view is 1.67 d on a 1.6:1 screen and 0.41 d on a
    0.45:1 phone):
    - d = 1000 m: spot clear, far side at 2300 m clear; seen width 1.7 /
      0.4 km, so the tile does not fit a landscape view;
    - 1500 m: clear, far side 2800 m clear; 2.5 / 0.6 km;
    - **1800 m: clear, far side 3100 m clear (under 3168); 3.0 / 0.7 km,
      the whole tile across a landscape view. Chosen: the farthest
      distance whose tile stays wholly in front of the fog;**
    - 2000 m: far side 3300 m, fog 0.08; 3.3 / 0.8 km;
    - 2500 m: far side 3800 m, fog 0.39; 4.2 / 1.0 km;
    - 3000 m: spot clear but the far side at 4300 m, fog 0.69;
    - 4800 m (before): the spot itself at fog 1.0.
      Worked out, not rendered: nobody has looked at OsmDemo at these
      distances yet. The unit test derives the bound (`cameraDistanceM +
tileHalfM <= fogNearRatio x farPlaneM`) from the copies, not from a
      literal.
  - `osmDemoBase(pageHref)` - the demo's address beside the lab: the lab is
    served at `<root>labs/globe/` by the design system's dev server and at
    `<root>lookdev/labs/globe/` on the site, the demo at `<root>osm/`, so
    the link keeps the origin and any sub-path the site is served under. A
    page served anywhere else falls back to the origin's `osm/`. Built from
    relative segments on purpose: the deploy rewrites QUOTED absolute route
    prefixes (the design system's routes: `fw`, `osm`, `vendor`, `globe`,
    `globe-assets`) under `/lookdev/` (`build-lookdev.mjs`'s rebase), and a
    literal absolute `osm/` path in this file would be sent to the demo's
    source files.
  - `handOverUrl({ pageHref, target, sun? })` - the demo at `target`:
    `lat`/`lng` (the user) and `clat`/`clng`/`cdist` (the camera, at the
    hand-over distance), five decimals as the demo writes them, signed zero folded;
    and, when `sun` is given and the sun is at or above civil twilight at
    the target, the globe's time as the demo reads it: `date` (the solar
    date at the target's longitude, `YYYY-MM-DD`) and `time` (apparent solar
    time, `HH:MM`, floored with a hair of tolerance as the demo prints it;
    written with a plain colon, as the lab keeps its own hash readable).
    Otherwise no time: the demo boots at its own afternoon sun, and the jump
    in the light is part of the cut. RangeError for a target that is not a
    latitude and longitude.
  - `HandOverSun` - `{ date, solarHours, elevationDeg }`; the lab computes
    it with the framework's `solarDateAt`, `apparentSolarTimeHours` and
    `solarPosition` for the globe clock's instant.
- Tests: `globe-handover.test.ts` - the site, the dev server, a page file
  and query, a sub-path, and the fallback; the user and the camera at the
  target with `cdist` 1800; the hand-over distance keeps the spot and the
  tile's far side in front of the fog and within the demo's maximum; five decimals and signed zero; the time while
  the sun is up, a booted minute read back, no time below -6° and the time
  at exactly -6°; the refusals; any place round-trips through the demo's
  `Number()` parsing within half a unit of the fifth decimal.
