# globe-city.ts

- Purpose: the city in the globe's own scene (globe city plan
  2026-10-05-0040 §12.5 C4, §14): asks the city's worker (the lab's
  `labs/globe/globe-city-worker.js`) to build it from the Osm library,
  turns the reply into three.js objects with the library's
  `gps-plus-slam-osm/three` (`cityObjects`), and places them on the
  globe's Earth-centred group through `ecefFromCityAt` (`globe-frame.ts`:
  the frame at the target, scaled from the library's ruler to the true
  ellipsoid, R2). A frame recentre therefore moves nothing (R16). Moved
  out of the globe lab (`labs/globe/globe-city.js`) as a pure refactor
  (editor-on-the-full-globe plan
  `2026-10-27-1850-editor-on-the-full-globe-plan.md`, primary repo, the
  city slice).
- Public API: `createGlobeCity(options)` with `GlobeCityOptions`:
  - `parent` (the lab passes `globe.group`), `ellipsoid`;
  - `createWorker()` (required): makes the city's worker, on the first
    load and again after one failed. The lab's is a literal
    `new Worker("/w/labs/globe/globe-city-worker.js", { type: "module" })`
    so the lookdev builder finds it;
  - `loadCityThree()` (required): the library's three.js entry, asked for
    once with the first city drawn and its promise kept. The lab's is
    `() => import("gps-plus-slam-osm/three")`, so its boot graph stays
    free of the Osm library (`build-lookdev.test.mjs`) and this package
    needs no dependency on it;
  - `roads` (default true) draws the roads and paths; `roadLiftM` (2) lifts
    them along the city's up and `roadOffset` (0, off) sets a polygon
    offset pulling them forward in depth: they drape on the library's
    heights, the relief's source and zoom but not its drawn mesh;
  - `heightsUrl`: the relief's height source, passed to the worker with
    every load so the city stands on the heights the ground is drawn from
    (G1 1d); checked by `cityHeights`, RangeError for a template it cannot
    read; the worker reads AWS Terrarium without it;
  - `now` (default `performance.now`): the clock of the arrival fade and
    of `mainMs`.

  It returns a `GlobeCity`:
  - `root`: the city's group, on `parent`, `matrixAutoUpdate` off (its
    matrix is `ecefFromCityAt` at the target);
  - `load({ lat, lng }, { zoom, fresh? })`: loads and builds the city at a
    place, its heights at the relief's zoom (round-4 plan 2026-10-11-0122
    §5: one load is the warm-up and the build), and returns a
    `GlobeCityLoadHandle` in the old arrival prefetch's shape:
    `progress()` (the first delivery's jobs, the library's
    `landingProgress`: the flight lands once the first ring is in while
    the outer rings keep loading, DEC-AW-1; frozen at an abort), `done`,
    `finished` (resolves `{ outcome, counts, ... }` once every job was
    tried once), `stats()` (`{ counts, inFlight, bytesStored }`) and
    `abort()` (stops the worker's load, posted only for the current one).
    The same place while its load runs or ended without an abort or a
    failure returns that load (no second download) unless `fresh` (a new
    flight: a new load, which reads what is stored as warm); another place
    supersedes, and the superseded load settles `aborted`. The city is
    drawn at each delivery (the first ring, then all, then a retry's),
    replacing the last; the arrival fade runs once per place. RangeError
    for a target that is not finite or a zoom that is not an integer 1-15.
    A worker that errors is terminated, its load settles `unavailable`
    and ends, and the next call makes a new one;
  - `setFade(0..1)`: 0 hides the city, 1 draws it whole, between a
    dithered share (`alphaHash`, R17: a transparent fade would reorder the
    city against the relief and the clouds), times the city's own fade-in
    over `CITY_ARRIVAL_FADE_MS` (1.5 s) from its arrival (r790 milestone
    review F4). RangeError outside 0-1;
  - `state()`: a `GlobeCityState`: the phase (`idle`, `loading`, `ready`
    or `failed`), `target`, `stage`, `counts`, `groundM`, `objects`,
    `mainMs` (the main thread's time turning a delivery into three.js
    objects), `message`, `fade`, `shown` and `load` (the current load's
    outcome, `ended` (true once the worker said `finished`, after its
    retries, or failed: no later stage can arrive), delivered stages,
    counts and progress; the recorder's fixed-view settle waits for
    `ended`);
  - `dispose()`: frees the city's own geometry and materials (never the
    trees' shared ones, `disposeCityObjects`), takes the root off its
    parent and ends the worker.

- The worker's messages (data from a worker): `progress` (`counts`,
  `progress`, `landing`), `settled` and `finished` (`outcome`, `counts`),
  `city` (`ok`, `message`, `stage`, `buildings`, `trees`, `roads`,
  `counts`, `groundM`). A reply whose `id` is not the current load's, or
  that is not an object, is ignored (superseded).
- Invariants & assumptions:
  - A failed build (a gap in the heights, a worker error, the three.js
    entry not loading) leaves no city drawn, an older place's included,
    and says why in `state().message`; nothing is drawn on the ellipsoid
    or on invented heights. The lab asks again after 10 s, three times at
    most (`globe-city-step.ts`).
  - The tree material is shared by every city, so its dither follows the
    one city's fade.
  - Every city object is a mesh (the library's `cityObjects`); a road has
    one material.
  - The three.js entry's promise is kept per city (it was per module in
    the lab; the lab makes one city, and the browser caches the import).
- Examples: see `labs/globe/globe-lab.js` (`city`, `cityKm`) in the design
  system:

  ```ts
  const city = createGlobeCity({
    parent: globe.group,
    ellipsoid: globe.tiles.ellipsoid,
    createWorker: () =>
      new Worker("/w/labs/globe/globe-city-worker.js", { type: "module" }),
    loadCityThree: () => import("gps-plus-slam-osm/three"),
  });
  const handle = city.load({ lat: 46.948, lng: 7.4474 }, { zoom: 12 });
  ```

- Tests: `globe-city.test.ts` (recording fakes of the worker, the
  three.js entry and the clock: the messages posted, reuse and
  supersession, the handle's pacing, settling and abort, the objects
  placed at the frame with the roads lifted and offset, the dithered
  arrival fade, failures and a crashed worker, dispose). The buildings
  themselves are the design system's `labs/globe/globe-city.smoke.spec.mjs`
  (the roads and walls drawn at Lucerne from routed fixtures; the city at
  Bern from a link: built from 26 fixture buildings, every corner within
  1.5 m horizontally of an independent ECEF computation, 0.53 m at
  2.4 km; not drawn at 40 km and a dithered half at 25 km).
