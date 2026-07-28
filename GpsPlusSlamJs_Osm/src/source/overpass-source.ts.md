# `source/overpass-source.ts`

## Purpose

The Overpass client. The only module in the package that touches the network,
and the home of every item of the plan's §5.3 network discipline.

## Public API

- `OverpassSource` implementing `OsmDataSource`.
- `OverpassSourceOptions` — `userAgent` (**required**), `endpoints`,
  `fetchImpl`, `maxConcurrent`, `maxRetries`, `timeoutSeconds`, `backoff`,
  `random`, `now`, `sleepImpl`.
- `DEFAULT_OVERPASS_ENDPOINTS`.
- `PermanentOverpassError`.
- `stats` — `{ requests, retries, deduplicated }`, for the demo app's
  "how many queries did this session make?" measurement the plan asks for.

## Invariants & assumptions

- **`userAgent` is required with no default.** A shared default would make every
  consumer of this library indistinguishable to the servers, so one bad actor
  would get all of them blocked. Constructing without one throws.
- **The default endpoint pool is not four independent quotas.** `z.` and `lz4.`
  are the two backends `overpass-api.de` load-balances across; rotating among
  them buys failover, not headroom. `overpass.kumi.systems` is included because
  it genuinely is independent — and it is the instance that answered when the
  main one 504'd during development. The real answer to a quota problem is a
  self-hosted instance passed via `endpoints`.
- **One in-flight request per tile.** The plan calls this "the most likely
  source of a quota-burning bug": the movement trigger and an explicit prefetch
  can ask for the same tile in the same tick. The in-flight entry is cleared in
  a `finally`, so a _failed_ tile is retryable rather than permanently poisoned
  by a cached rejection.
- **At most `maxConcurrent` (default 2) requests at once**, via a counting
  semaphore.
- **Permanent failures and aborts escape the retry loop.** Both were originally
  caught by the loop's own `catch` and retried — a 400 cost four requests
  instead of one, and an abort kept working on an area the user had left.
  `PermanentOverpassError` exists to make that distinction explicit.
- **An HTML error page served with status 200 is retryable.** Real public
  instances do this under load; `.json()` throws and the throw must not be a
  hard failure.
- **Everything injectable is injected** — `fetch`, `now`, `random`, `sleepImpl`
  — so the whole policy is tested offline, deterministically, with no real
  timers and no real requests.

## Known operational reality

Public instances measured 2026-07-28 returned 75–130 s response times with
frequent 504s, and the plan's unfiltered query never completed at any tile size
tried. See `../testdata/README.md`. This class's retry, rotation and pool are
therefore load-bearing rather than defensive polish — and a self-hosted instance
is effectively required for production use.

## Tests

`overpass-source.test.ts` — 23 tests, one per discipline item: construction
guards, the exact request shape and headers, provenance, dedup (including
release after success and after failure), bounded concurrency, retry on each
retryable status with endpoint rotation, no-retry on 400, `Retry-After` in both
forms, jittered fallback, give-up reporting, transport-level throws,
HTML-in-a-200, and `AbortSignal` before and during a retry wait.
