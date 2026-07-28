# `elevation/opentopodata-provider.ts`

## Purpose

Point-query elevation as a **fallback** for when the Terrarium bucket is
unavailable — batched, self-throttled, and refusing to be used as a grid source.

## Public API

- `class OpenTopoDataProvider` (+ `stats`: `requests`, `points`,
  `throttleWaitsMs`)
- `class TooManyElevationPointsError`
- `OPENTOPODATA_ATTRIBUTION`, `OPENTOPODATA_MAX_LOCATIONS_PER_REQUEST` (100),
  `OPENTOPODATA_MIN_REQUEST_INTERVAL_MS` (1000)

## Invariants & assumptions

- **Never the primary.** The public endpoint allows 100 locations/request,
  1 request/second and 1,000 requests/day — 100,000 points/day for every user of
  this library combined, against ~117,649 res-13 cells in ONE res-7 fetch tile.
  Use it for region centroids, never for a grid.
- **The cap is enforced locally, before a request is spent.** Discovering the
  limit by being rate-limited means the shared quota is already gone.
  `maxPointsPerRun` defaults to exactly one request's worth.
- **1 req/s is waited out**, with an injected clock and sleep so the tests never
  actually wait.
- **`null` elevation maps to `undefined`, never `0`.** `null` means "outside the
  dataset"; turning it into zero would put the Alps at sea level.
- **A short `results` array pads rather than misaligns.** Silently shifting every
  elevation onto the wrong position is the dangerous failure here.
- Non-OK statuses and malformed bodies degrade to `undefined`; aborts propagate.

## Examples

```ts
const fallback = new OpenTopoDataProvider();
const [h] = await fallback.elevationAt([regionCentroid]);
```

## Tests

`opentopodata-provider.test.ts` — refusing an oversized batch without touching
the network, the throttle wait, ordered results, `null` to `undefined`, non-OK
and malformed bodies, short-array padding, and the empty-input short-circuit.
