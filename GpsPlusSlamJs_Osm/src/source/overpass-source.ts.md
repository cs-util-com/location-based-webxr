# `source/overpass-source.ts`

## Purpose

The Overpass client. The only module in the package that touches the network,
and the home of every item of the plan's §5.3 network discipline.

## Public API

- `OverpassSource` implementing `OsmDataSource`.
- `OverpassSourceOptions` — `userAgent` (**required**), `endpoints`,
  `fetchImpl`, `maxConcurrent`, `maxRetries`, `timeoutSeconds`, `backoff`,
  `random`, `now`, `monotonicNow`, `sleepImpl`, `selectKeys`, `budget`,
  `maxAttemptLog`.
- `DEFAULT_OVERPASS_ENDPOINTS`.
- `PermanentOverpassError`.
- `stats` — `{ requests, retries, deduplicated }`, for the demo app's
  "how many queries did this session make?" measurement the plan asks for.

## Invariants & assumptions

- **`userAgent` is required with no default.** A shared default would make every
  consumer of this library indistinguishable to the servers, so one bad actor
  would get all of them blocked. Constructing without one throws.
- **The default endpoint pool is a PREFERENCE ORDER, walked from the front.**
  `pickEndpoint` returns `endpoints[attempt % length]` — no shuffle. It used to
  start at a random offset to spread load; that property was given up knowingly
  because it made the order decorative, and the measured spread between hosts is
  **4.2x** on an identical res-7 tile. The cost is herding onto `endpoints[0]`,
  which is why the list must stay short and be re-measured rather than trusted.
  - **The order came from a measurement with a shelf life.** All six known free
    global instances were timed on 2026-07-28 by
    `scripts/benchmark-endpoints.mjs`; see
    `GpsPlusSlamJs_Docs/docs/2026-07-28-2344-overpass-endpoint-benchmark-results.md`.
    One sample per host, one location, one time of day — re-run rather than
    trusting it indefinitely.
  - **It is three operators, not five entries of headroom.** `z.` and `lz4.` are
    the backends `overpass-api.de` load-balances across (byte-identical
    payloads), and **`overpass.kumi.systems` and `overpass.private.coffee` are
    the same instance** — also byte-identical, confirming the OSM wiki's
    "Private.coffee (formerly overpass.kumi.systems)". Only the canonical name is
    listed. **The real answer to a quota problem is still a self-hosted instance
    passed via `endpoints`.**
  - **The FOSSGIS main entry is last** because it is the only host that failed
    the query outright (504 after 8.3 s, the same signature as the key-regex
    form) while its own backends served it. It stays in the pool: one failure is
    not grounds for removal.
- **One in-flight request per tile.** The plan calls this "the most likely
  source of a quota-burning bug": the movement trigger and an explicit prefetch
  can ask for the same tile in the same tick. The in-flight entry is cleared in
  a `finally`, so a _failed_ tile is retryable rather than permanently poisoned
  by a cached rejection.
- **Concurrent requests for one tile make one query — without sharing signals.**
  De-dup goes through [`InFlightRequests`](./in-flight-requests.ts.md), so the
  movement trigger and an explicit prefetch can join the same tile without
  inheriting each other's lifetimes: cancelling one no longer aborts the other's
  request, and a joiner's own abort really does cancel its own work.
- **At most `maxConcurrent` (default 2) requests at once**, via a counting
  semaphore that **hands the slot over instead of releasing it**.
  - A releaser with someone queued never decrements `active`; it passes its own
    already-counted slot on, and only the last one out decrements.
  - Releasing instead would leave a one-microtask window (between `active--` and
    the woken waiter's continuation) in which `active` reads below the cap while
    a waiter is already committed. A caller arriving there takes the slot too,
    and the cap is exceeded — which is what earns a 429.
  - Covered by a test that sweeps the arrival across the whole window rather
    than guessing one offset; on the released-slot version only offset 7 of 10
    tripped it.
- **`userAgent` does not reach the server from a browser.** `User-Agent` and
  `Referer` are on the fetch spec's forbidden-request-header list, so the
  browser drops both silently — no error, no warning. The option still does its
  job under Node/`undici`, which is why it is kept and still required, but a
  consumer debugging a block from a browser build will not find the header on
  the wire.
- **Permanent failures and aborts escape the retry loop.** Both were originally
  caught by the loop's own `catch` and retried — a 400 cost four requests
  instead of one, and an abort kept working on an area the user had left.
  `PermanentOverpassError` exists to make that distinction explicit.
- **An HTML error page served with status 200 is retryable.** Real public
  instances do this under load; `JSON.parse` throws and the throw must not be a
  hard failure.
- **Everything injectable is injected** — `fetch`, `now`, `monotonicNow`,
  `random`, `sleepImpl`
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

## `timings` — what this source measures, and where each clock stops

Filled on every delivery (`OsmTileTimings` in `osm-data-source.ts.md`). The
intervals abut without overlapping, and the boundaries are the whole point:

- **`slotWaitMs`** — inside `withConcurrencyLimit`, and 0 when the slot was
  taken synchronously. Passed DOWN to the fetch rather than measured inside it,
  because queueing is a real stage of the wait: folded into transport it reads
  as a slow server, dropped it reads as time that never happened.
- **`transportMs`** — opened before the retry loop and closed after
  `response.text()`, so it deliberately spans every attempt and every backoff
  sleep. `attempts` is reported beside it for that reason.
- **`decodeMs` / `parseMs`** — `JSON.parse` and `parseOverpassJson`, split
  because the plan predicts one of them dominates a warm click and a single
  number covering both would rank them together and name neither.
- **`joinedMs`** — a dedup joiner's own wall wait. It shares the features and
  paid none of the fetch, so every other duration is 0 for it.

`readAndDecode` is a separate method **for memory, not tidiness**: returning
drops the frame holding the ~21 MB body string, which inlined would stay
reachable through `parseOverpassJson`. `response.json()` used to make this moot
by keeping the intermediate engine-owned; splitting the two costs is what made
the string ours to release.

Durations go through `elapsedMs`, which floors at zero. A hostile clock is not
expected — that is what `monotonicNow` is for — but a negative duration makes
the reconciliation sum close by CANCELLING, so the one gate that would catch a
clock problem goes quiet exactly when it should shout.
