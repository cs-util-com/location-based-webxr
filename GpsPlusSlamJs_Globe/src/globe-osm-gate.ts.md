# globe-osm-gate.ts

- Purpose: when the OpenStreetMap overlay (`globe-osm-overlay.ts`) may ask
  for tiles, and how often. The OSM tile servers run under a usage policy
  (no heavy use, a visible credit with a link); every limit here keeps the
  editor a light user. Pure functions and one small stateful ceiling; no
  library overlay code.
- Public API:
  - `GLOBE_OSM`: `fadeM` 300 (the fade's end and the request reach),
    `fadeStartShare` 0.7, `minZoom` 15, `requestsPerMinute` 150,
    `maxAboveGroundM` 200, `maxSpeedMps` 50 (off above these),
    `onBelowAboveGroundM` 180, `onBelowSpeedMps` 45 (on only below
    these), `rampMs` 300 (the drawn map's fade in or out), `reevaluateMs` 500,
    `reevaluateLimit` 8, `retryBackoffMs` 5000, 10000, 20000, 60000 (how
    long the failed tiles wait before they are asked for again: each
    retry that fails waits the next, then the last again; a retried tile
    that gets its map starts them over; once any map request was
    answered since the last retry, the next waits the first step at most,
    so a refusal that ended is not waited out at 60 s), `giveUpRetries` 3 (retries after
    which the relief stops waiting for a tile's map, `mapReady`),
    `requestTimeoutMs` 60000 (a map request's time limit), `gain` 1 (the
    map's darkening, `patchOsmFade`: 1 draws it as the tile server made
    it), `gainMode` "flat" (how the gain darkens, `OsmGainMode`: "flat"
    multiplies, "compress" compresses the luma), `resolution` 256, `keepRegions` 64 (released map textures kept in memory, below).
  - `osmGateLimits(limits, maxZoom)` -> `OsmGateLimits` (frozen): the
    gate's `minZoom`, `maxAboveGroundM`, `onBelowAboveGroundM`,
    `maxSpeedMps`, `onBelowSpeedMps`, the caller's over `GLOBE_OSM`'s.
    RangeError for a height or speed that is not > 0 (+Infinity opens
    it), an "on again" limit above its "off" limit, or a `minZoom` that
    is not an integer in [0, `maxZoom`]. An editor looking at a place
    from above wants the map far higher than a flight does, and its
    camera jumps across the place, so speed means nothing there.
  - `osmOverlayActive({ aboveGroundM, speedMps }, wasActive = false,
limits = GLOBE_OSM)`: the limits below are the defaults;
    with hysteresis (G1 review L2): off above 200 m over the ground or 50
    m/s; on only at or below 180 m and 45 m/s; between the two it keeps
    `wasActive`. False for anything unknown (NaN). Without the band a
    camera hovering at 200 m, or a walk at the speed limit, switched the
    map (and its requests) every frame.
  - `rampOsmOn(current, target, dtMs, rampMs = 300)`: the shader switch
    `uOsmOn` moved `dtMs / rampMs` toward `target`, landing on it, never
    past it; a step that is not finite and > 0 leaves it.
  - `createRequestCeiling(perMinute, now?)`: a sliding-minute ceiling,
    `waitMs()`, `take()`, `inLastMinute()`, `total()`. RangeError unless
    a positive integer.
  - `regionNearCamera(region, camera, { ellipsoid, groundAtM, withinM })`:
    whether a region (radians `[w, s, e, n]`) on the ground comes within
    `withinM` of the camera (ellipsoid frame): its bounding sphere, the
    centre at the sampled ground (the ellipsoid where none is loaded),
    the radius to its farthest corner. RangeError for a malformed region
    or reach.
  - Types: `OsmGateLimits`, `OsmActiveLimits` (the band without
    `minZoom`), `RequestCeiling`.
- Invariants & assumptions:
  - The band's widths are a choice, not a measurement: about a tenth of
    each limit, wide enough that GPS height noise and a walking pace's
    jitter (a few metres, a few m/s) cannot cross it both ways in a
    second, narrow enough that the limits stay the plan's. A band of a
    twentieth (190 m, 47.5 m/s) would still hold against that noise; the
    verdict "no flicker" does not depend on the exact value as long as
    the band is wider than the noise of the input. The 300 ms ramp is a
    look choice, nothing measured.
  - The ceiling counts in a sliding minute from an injectable clock
    (`now`, `performance.now` by default), so tests drive it without
    timers.
- Example:

  ```ts
  const limits = osmGateLimits({ maxAboveGroundM: 2000 }, 19);
  let active = false;
  active = osmOverlayActive({ aboveGroundM, speedMps }, active, limits);
  const ceiling = createRequestCeiling(GLOBE_OSM.requestsPerMinute);
  if (ceiling.waitMs() === 0) ceiling.take();
  ```

- Tests: `globe-osm-gate.test.ts` (the plan's limits, the active rule and
  unknowns, the hysteresis at both edges with a property over paths, the
  caller's limits and their refusals, the ramp with a property that it
  never overshoots, the sliding ceiling, the region test by extent and on
  the sampled ground) and `globe-osm-gate.property.test.ts` (random
  bursts: no sliding minute above the ceiling, no request dropped). The
  overlay's tests pin the same limits through the library's class.
