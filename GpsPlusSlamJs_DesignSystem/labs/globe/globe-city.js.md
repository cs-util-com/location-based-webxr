# globe-city.js

- Purpose: the city in the globe's own scene (globe city plan
  2026-10-05-0040 §12.5 C4, §14): asks `globe-city-worker.js` to build it
  from the Osm library, turns the reply into three.js objects with the
  library's `gps-plus-slam-osm/three` (`cityObjects`), and places them on
  the globe's Earth-centred group through the Globe's `ecefFromCityAt` (the
  frame at the target, scaled from the library's ruler to the true
  ellipsoid, R2). A frame recentre therefore moves nothing (R16).
- Public API: `createGlobeCity({ parent, ellipsoid, createWorker?, roads?,
roadLiftM?, roadOffset?, heightsUrl? })` (`heightsUrl` the relief's height
  source, passed to the worker with every load so the city stands on the
  heights the ground is drawn from, G1 1d; checked by `cityHeights`,
  RangeError for a template it cannot read; the worker reads AWS Terrarium
  without it) →
  - `root`: the city's group, on `parent` (the lab passes `globe.group`);
  - `load({ lat, lng }, { zoom, fresh? })`: loads and builds the city at a
    place, its heights at the relief's zoom (round-4 plan 2026-10-11-0122
    §5: one load is the warm-up and the build), and returns a handle in the
    old arrival prefetch's shape: `progress()` (the first delivery's jobs,
    the library's `landingProgress`: the flight lands once the first ring
    is in while the outer rings keep loading, DEC-AW-1), `done`, `finished`
    (resolves `{ outcome, counts, ... }` once every job was tried once),
    `stats()` (`{ counts, inFlight, bytesStored }`) and `abort()` (stops
    the worker's load). The same place while its load runs or ended
    without an abort or a failure returns that load (no second download)
    unless `fresh` (a new flight: a new load, which reads what is stored as
    warm); another place supersedes. The city is drawn at each delivery
    (the first ring, then all, then a retry's), replacing the last; the
    arrival fade runs once per place. RangeError for a target that is not
    finite or a zoom that is not an integer 1-15. The worker is made on the
    first call (`/w/labs/globe/globe-city-worker.js`); a worker that errors
    is terminated, its load settles `unavailable`, and the next call makes
    a new one;
  - `roads` (default true) draws the roads and paths; `roadLiftM` (2) lifts
    them along the city's up and `roadOffset` (0, off) sets a polygon
    offset pulling them forward in depth: they drape on the library's
    heights, the relief's source and zoom but not its drawn mesh;
  - `setFade(0..1)`: 0 hides the city, 1 draws it whole, between a
    dithered share (`alphaHash`, R17: a transparent fade would reorder the
    city against the relief and the clouds), times the city's own
    fade-in over 1.5 s from its arrival (r790 milestone review F4).
    RangeError outside 0-1;
  - `state()`: `{ phase: idle | loading | ready | failed, target, stage,
counts, groundM, objects, mainMs, message, fade, shown, load }`
    (`mainMs` the main thread's time turning a delivery into three.js
    objects; `load` the current load's outcome, `ended` (true once the
    worker said `finished`, after its retries, or failed: no later stage
    can arrive), delivered stages, counts and progress; the recorder's
    fixed-view settle waits for `ended`);
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
- Tests: `globe-city.smoke.spec.mjs` (the roads and walls drawn at
  Lucerne from routed fixtures; the city at Bern from a link: built
  from 26 fixture buildings, every corner within 1.5 m horizontally of an
  independent ECEF computation, 0.53 m at 2.4 km; not drawn at 40 km and a
  dithered half at 25 km).
