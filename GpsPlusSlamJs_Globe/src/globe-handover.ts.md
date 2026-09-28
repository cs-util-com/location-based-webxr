# globe-handover.ts - the link from the globe to the city

- Purpose: round-2 plan 2026-09-26-2055 DEC-FB2-3, M3g. The pin's dive ends
  by opening the OSM demo at the user's position: a quick cut (the seamless
  descent is the globe plan's phase 5). This module builds that link.
- Public API:
  - `OSM_HANDOVER` - the demo's side of the contract, written out (this
    package does not depend on the demo): `maxCameraDistanceM` 4800 (its
    `url-state.ts` `MAX_DISTANCE_M`; a larger `cdist` is refused and the
    demo opens its default view) and `minSunElevationDeg` -6 (its
    `sun-clock.ts` `SUN_CLOCK.minElevationDeg`, civil twilight, below which
    its sky does not render reliably). If the demo changes either, change
    it here.
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
    `lat`/`lng` (the user) and `clat`/`clng`/`cdist` (the camera, at its
    farthest), five decimals as the demo writes them, signed zero folded;
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
  target with `cdist` 4800; five decimals and signed zero; the time while
  the sun is up, a booted minute read back, no time below -6° and the time
  at exactly -6°; the refusals; any place round-trips through the demo's
  `Number()` parsing within half a unit of the fifth decimal.
