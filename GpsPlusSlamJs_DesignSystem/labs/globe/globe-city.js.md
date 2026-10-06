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
  - `build({ lat, lng })`: asks for the city at a place; a later call
    supersedes an earlier one (an older reply is ignored). RangeError for a
    target that is not finite. The worker is made on the first call
    (`/w/labs/globe/globe-city-worker.js`, the worker view);
  - `setFade(0..1)`: 0 hides the city, 1 draws it whole, between a
    dithered share (`alphaHash`, R17: a transparent fade would reorder the
    city against the relief and the clouds). RangeError outside 0-1;
  - `state()`: `{ phase: idle | loading | ready | failed, target, counts,
groundM, objects, message, fade }`;
  - `dispose()`: frees the city's own geometry and materials (never the
    trees' shared ones, `disposeCityObjects`) and ends the worker.
- Invariants & assumptions:
  - A failed build (no heights, a worker error) leaves the city undrawn
    and says why in `state().message`; nothing is drawn on the ellipsoid.
  - The tree material is shared by every city, so its dither follows the
    one city's fade.
- Examples: see `globe-lab.js` (`city`, `cityKm`).
- Tests: `globe-city.smoke.spec.mjs` (the city at Bern from a link: built
  from 26 fixture buildings, every corner within 1.5 m horizontally of an
  independent ECEF computation, 0.53 m at 2.4 km; not drawn at 40 km and a
  dithered half at 25 km).
