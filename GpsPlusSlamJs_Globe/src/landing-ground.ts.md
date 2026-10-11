# landing-ground.ts - the landing's ground, read early

- Purpose: round-4 plan 2026-10-11-0122 DEC-R4-1 (§6 items 3 and 4). The
  owner lands about 150 m above the GROUND at his place, not above sea
  level, so the flight needs the ground's height under its target before
  it plans its meteor line (a late raise turns the view: the cold review
  measured about 0.25 degree at the gate and 1.2 at 20 km). This module
  reads that height from ONE Terrarium tile at z12 under the target, the
  relief's and the city's own source and zoom (the city plan's R13: one
  height source), and decides when the relief's own height later revises
  it.
- Public API:
  - `LANDING_GROUND`: `zoom` 12 (`GLOBE_TERRAIN.maxZoom`, tested equal),
    `timeoutMs` 5,000, `marginM` 25, `lowerPerHeight` 0.0125.
  - `GroundSource`: `{ elevationAt(positions, signal?) }`, what the read
    needs of an elevation source; the lab passes the Osm library's
    `TerrariumProvider` (`/osm-lib/elevation/terrarium.js`) on the relief's
    own URL template (AWS Terrarium, or the synthetic heights with
    `reliefHeights=synthetic`), at `LANDING_GROUND.zoom`, with
    `requestTimeoutMs` set to the same deadline.
  - `readLandingGroundM(source, place, { timeoutMs?, signal? })` ->
    `Promise<{ groundM, source: "tile" | "fallback" }>`: the height under
    the place, never below 0 (the relief draws the sea at 0, so a depth
    reads 0). Never rejects: no source (`relief=0`), a non-finite place,
    an empty or non-finite answer, a rejection, the timeout or the
    caller's abort all give `{ groundM: 0, source: "fallback" }`, the
    ellipsoid. The read is aborted at the timeout and at the caller's
    abort, and its answer is not waited for (a source that ignores its
    signal cannot hold the flight).
  - `groundRevisionM(currentM, reliefM, { marginM?, heightM? })` -> the
    relief's height (never below 0) when it differs from the current
    ground by more than the margin and, for a LOWER ground, the drop is at
    most `lowerPerHeight` of `heightM` (the camera's height above the
    current ground; default: any), else null (no revision); null for a
    null or non-finite relief height.
  - Why the lowering's limit (measured in `flight-ground.test.ts`): a
    raise turns the meteor's view by under 0.01 degree at any height; a
    lowered ground puts the camera above its line and the replan turns the
    view by about 30-50 x (drop / height) degrees (165 m: 1.0 at 5 km, 3.5
    at 2 km). At 1.25 % the turn stays at 0.4-0.6 degree; a lowering
    found later is not applied, and the flight lands that much higher
    than 150 m (the swept alternatives are in the R4b record).
- Invariants & assumptions:
  - Pure but for the source it is handed: no decoding here (the Osm
    library's decoder is the one the relief's city and the arrival
    prefetch use).
  - The revision reads the relief's FINEST level only
    (`globe-terrain.ts`'s `finestElevationAt`): the relief samples the
    same tile through its own grid (258 x 258 against 256 x 256, another
    bilinear lattice), about a pixel apart (25 m at 47 N) on slopes, hence
    the margin. Its coarser levels are hundreds of metres off in the Alps
    and would replan for nothing. So a revision mostly follows a failed or
    slow read, which leaves the ellipsoid: a raise.
  - Settles: a revised ground is never revised again by the same relief
    height (property-tested), so a frame loop calling it every frame
    replans once.
  - The timeout (5 s) is a judgement, not a measurement on the phone: one
    z12 tile is about 50-150 KB and the link's flight spends its first
    seconds 65,000 km up, where a late ground is a harmless replan
    (measured in `flight-ground.test.ts`: under half a degree of view turn
    a frame). What would change it: a phone whose cold fetch of one tile
    routinely takes longer than 5 s (then the revision does the work, late).
- Example:

  ```ts
  const ground = await readLandingGroundM(provider, { lat: 47.05, lng: 8.31 });
  // { groundM: 435.2, source: "tile" }
  const revised = groundRevisionM(ground.groundM, reliefFinestM); // null or m
  ```

- Tests: `landing-ground.test.ts` (the zoom against the relief's, a read,
  the sea at 0, every fallback, the timeout and the abort with fake timers,
  the revision's margin, its property that it settles). The flights over a
  lifted target: `flight-ground.test.ts`. In the page:
  `labs/globe/globe-landing-ground.smoke.spec.mjs` (the read through the
  Osm library's decoder on the relief's synthetic tile, against the
  relief's own height).
