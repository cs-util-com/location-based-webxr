# globe-city.js

- Purpose: the city in the globe's own scene (globe city plan
  2026-10-05-0040 §12.5 C4, §14): asks `globe-city-worker.js` to build it
  from the Osm library, turns the reply into three.js objects with the
  library's `gps-plus-slam-osm/three` (`cityObjects`), and places them on
  the globe's Earth-centred group through the Globe's `ecefFromCityAt` (the
  frame at the target, scaled from the library's ruler to the true
  ellipsoid, R2). A frame recentre therefore moves nothing (R16).
- Public API: `createGlobeCity({ parent, ellipsoid, createWorker? })` →
  - `root`: the city's group, on `parent` (the lab passes `globe.group`);
  - `build({ lat, lng }, { zoom })`: asks for the city at a place, its
    heights at the relief's zoom (the lab passes `GLOBE_TERRAIN.maxZoom`);
    a later call supersedes an earlier one (an older reply is ignored).
    RangeError for a target that is not finite or a zoom that is not an
    integer 1-15. The worker is made on the first call
    (`/w/labs/globe/globe-city-worker.js`, the worker view); a worker that
    errors is terminated and replaced at the next call;
  - `setFade(0..1)`: 0 hides the city, 1 draws it whole, between a
    dithered share (`alphaHash`, R17: a transparent fade would reorder the
    city against the relief and the clouds), times the city's own
    fade-in over 1.5 s from its arrival (it usually arrives after the
    landing, below the altitude band, and switched on in one frame before,
    r790 milestone review F4). RangeError outside 0-1;
  - `state()`: `{ phase: idle | loading | ready | failed, target, counts,
groundM, objects, message, fade, shown }` (`fade` as asked, `shown` with
    the arrival's fade-in);
  - `dispose()`: frees the city's own geometry and materials (never the
    trees' shared ones, `disposeCityObjects`) and ends the worker.
- Invariants & assumptions:
  - A failed build (a gap in the heights, a worker error) leaves no city
    drawn, an older place's included, and says why in
    `state().message`; nothing is drawn on the ellipsoid or on invented
    heights. The lab asks again after 10 s, three times at most.
  - The tree material is shared by every city, so its dither follows the
    one city's fade.
- Examples: see `globe-lab.js` (`city`, `cityKm`).
- Tests: `globe-city.smoke.spec.mjs` (the city at Bern from a link: built
  from 26 fixture buildings, every corner within 1.5 m horizontally of an
  independent ECEF computation, 0.53 m at 2.4 km; not drawn at 40 km and a
  dithered half at 25 km).
