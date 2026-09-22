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

- **Every attempt carries a transport deadline, default 45 s
  (`requestTimeoutMs`).** `[timeout:180]` bounds Overpass's server-side
  EXECUTION and says nothing about a connection that is accepted and then goes
  quiet; before 2026-09-20 nothing here bounded the transport at all, so the
  worst case was whatever TCP/OS timeout applied. A field run measured
  `overpass.private.coffee` holding a request 199 s before answering.
  - **A deadline hit FAILS OVER; it does not kill the tile.** It is spelled
    `AbortSignal.timeout`, which rejects with `TimeoutError` - a retryable
    transport failure to the attempt loop. `isAbortError` matches only
    `AbortError`, which the loop rethrows, so a manually-aborted deadline would
    convert every slow request into a dead tile. Measured in simulation at
    single-cycle success 97.0% against 54.9%.
  - **45 s is a swept value, not a round one.** Mean time-to-first-geometry
    114.2 s unbounded against 59.7 s at 45 s; p90 336.3 s against 115.1 s. The
    knee is between 30 s and 35 s: below it the deadline kills `maps.mail.ru`'s
    genuine ~31-35 s successes and costs more than it saves. 45 s over the point
    optimum of 35 s because 35 s is tuned to the maximum of a three-sample
    distribution. See `DEFAULT_REQUEST_TIMEOUT_MS` for what would move it.
  - A caller's own `signal` still aborts hard and is never retried; the two
    reasons stay distinguishable through `composeSignals`.

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
  - **A RACED TILE TAKES TWO UNITS OF THIS BUDGET, not one** (2026-09-22). The
    gate counts tiles, so before this was fixed a racing tile made two requests
    against a budget that thought it had made one, and a client configured for
    two in-flight requests made four. The second unit is taken opportunistically
    (`tryTakeExtraSlot`); a refusal simply means this tile does not race.
    Making the gate WEIGHTED instead would deadlock any consumer who set
    `maxConcurrent: 1`, because a weight of two can never be satisfied.

- **A COLD TILE THE CALLER IS WAITING FOR IS RACED at two distinct
  operators**, first answer wins, loser cancelled. Measured 2026-09-21: within the shipped 45 s deadline one attempt
  at a time served 4 of 9 tiles at a 32.2 s median; the race served 7 of 9 at
  27.0 s. **Most of that is the success rate, not the latency** - in 3 of 9
  races the first-drawn operator failed outright.
  - **The cost is the extra REQUEST and nothing reduces it.** Cancelling the
    loser frees a socket, not the server's work: across all nine measured races
    the loser had transferred at most 695 bytes - an error page - when the
    winner finished, and the query had already been executed regardless.
  - **Two DISTINCT operators, asserted rather than assumed.** Same-host
    concurrency is refused - measured in three independent runs. A later change
    to the draw that put two of one operator first would otherwise land in the
    one arrangement every measurement says does not work.
  - **The loser's cancellation is not the caller's abort.** Each racer gets a
    private controller composed with the caller's signal, so our own
    cancellation is swallowed while a real abort still propagates.
  - Both outcomes reach the health tally, and `stats.requests` counts two - the
    numbers this client's load on donated infrastructure is read from.
  - Covered by a test that sweeps the arrival across the whole window rather
    than guessing one offset; on the released-slot version only offset 7 of 10
    tripped it.
  - **A SPECULATIVE tile is NOT raced** (`FetchTileOptions.speculative`,
    2026-09-22). The whole case for spending a second request is that somebody
    is sitting in front of a wait; nobody is waiting on a background ring warm,
    and if it fails the neighbour is merely not warm while the fetch the user
    eventually makes is itself raced. The demo's ring warm went from 14
    requests to 7 - an e2e counting requests is what found the cost, before
    anyone read this code. The spare concurrency unit stays free for a
    foreground tile as well, which is the same argument in resource terms.
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

`overpass-source.test.ts` — one per discipline item: construction guards, the
exact request shape and headers, provenance, dedup (including release after
success and after failure), bounded concurrency, retry on each retryable status
with endpoint rotation, no-retry on 400, `Retry-After` in both forms, jittered
fallback, give-up reporting, transport-level throws, HTML-in-a-200, and
`AbortSignal` before and during a retry wait.

**The backoff-duration tests pin the pool to ONE entry, and that is load-bearing
rather than incidental.** Since 2026-08-19 the client sleeps only when the next
attempt would return to an operator that has already refused
([`overpass-operators.ts.md`](./overpass-operators.ts.md)), so against the
default pool a single failure is followed immediately by a different host and no
sleep at all — which would leave those assertions vacuous rather than failing.
A one-entry pool separates "how long is the wait" from "is there a wait", and
the second question has its own three tests.

## Endpoint selection: a weighted draw, not a walk

`DEFAULT_OVERPASS_ENDPOINTS` is no longer the selection rule — it is the
inventory. Which endpoint an attempt uses comes from
[`endpoint-order.ts`](./endpoint-order.ts.md), which draws over **operators**
(weighted by `DEFAULT_OPERATOR_WEIGHTS`) and returns a permutation of the pool
for that one tile.

**Those weights are now a PRIOR, not the answer.** Since 2026-09-21 the source
holds an [`operator-health.ts`](./operator-health.ts.md) tally and passes
`health.weightsFrom(DEFAULT_OPERATOR_WEIGHTS)` to the draw, so a host that keeps
refusing receives less traffic and one that recovers earns it back. The
constants are untouched until something has actually been observed, so the first
fetch of a session draws exactly as they say.

- **Each attempt is classified where its status is**, not in the catch where it
  is gone: a 504 is the host refusing us, a 400 or 414 is our own malformed
  query (`"ours"`, dropped rather than counted), an abort is the caller leaving
  (also dropped). Getting the middle one wrong would walk the pool one endpoint
  at a time while the query stayed broken.
- **Success is recorded AFTER `toResult`**, because a 200 carrying an HTML error
  page is not this operator serving us, and that is where it is discovered.

Three consequences of the draw itself worth knowing:

- **The first attempts hit distinct operators.** With the default pool that is
  three different quotas before any repeat, which is what makes a retry
  informative — under the old `attempt % length` walk, attempt 2 returned to
  FOSSGIS and a 429 on attempt 0 largely predicted it.
- **`maxRetries` rose from 3 to 4.** The loop is `attempt <= maxRetries`, so 3
  gave four attempts against a five-entry pool and bare `overpass-api.de` was
  **unreachable in the shipped configuration** — silently, since nothing named
  it.

  it will grant, and that answer is only useful for the host most likely to be
  asked for a tile; drawing would sample a different host from the one the
  fetch goes to.

## Backoff: when the client waits, and when it just asks somebody else

Rotation and backoff used to be independent — the loop moved to the next
endpoint on every attempt AND slept the full delay between them. That combination
is what the twelfth testing session measured as "a 429, and then another thirty
seconds": the client waited for **FOSSGIS's** quota to recover, honouring
`Retry-After` up to the 30 s clamp, and then asked `maps.mail.ru`, whose quota
was never involved.

The rule now: **sleep only when the next attempt would return to a refused
operator.** Backoff is pressure relief on a quota, so it applies where a quota
is about to be asked again, and nowhere else.

With the default pool, the draw puts three different operators in the first
three attempts, so **none of the first three waits** and the first wait falls
before the fourth. (This paragraph described the pre-M6 walk — "`z.` waits as
before" — for one commit after the draw made it untrue.)

The same predicate also removed a pure-waste sleep nobody had reported: the
retryable-status path had no `attempt >= maxRetries` guard, so the final attempt
slept up to 30 s and then fell out of the loop and threw.

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

## Rate-limit attribution (F2c, 2026-08-19)

A 429 penalises **only the operator that issued it**. Three facts make this
non-obvious in the code:

- `tryAcquire` runs once per **tile**, in `fetchTileUncached`, before any
  endpoint is drawn — so it is passed `poolOperators` and refuses only when
  every one of them is blocked. That keeps `RateLimitedError` meaning "there is
  nowhere to go", which is what `CachingSource`'s stale-serve and
  `area-loader`'s prefetch back-off branch on.
- `noteRateLimit` takes the **endpoint** as a parameter rather than reading
  `response.url`, because tests inject a fake `fetchImpl` whose responses carry
  no url; an unattributed penalty silently falls back to blocking the whole
  pool, which is the defect restored in exactly the configuration that tests it.
- `planAttemptOrder` filters out endpoints whose operator is currently blocked,
  and falls back to the unfiltered order if that would leave nothing — a shared
  budget can be penalised by another source between the acquire and the draw,
  and an empty order would make the tile issue zero requests and report "no
  data" instead of a rate limit.

**What this does NOT establish.** DEC-U2 chose to fix this without first
reproducing which mechanism caused the owner's reported 30 s stall — the retry
sleep (fixed in round one) or this global block. Both are now fixed; which one
they hit is unknown and is not claimed either way.

## `syncBudget` was removed (DEC-V3, 2026-08-19)

It fetched `/api/status` from the pool's first entry and fed the result to the
slot budget. **It had no production caller in either repo** — only tests — and
the reason it never acquired one is the measurement the budget is built on:
`/api/status` lags actual consumption badly enough that three concurrent queries
returned `200, 429, 200` while a status read 600 ms into the burst still
reported the full allocation free. The local budget is authoritative precisely
because that snapshot cannot be trusted, which left this correcting a view that
does not need correcting.

The per-operator work of the same day also found a latent whole-pool lock
reachable only through it. Fixing a latent bug in code nobody calls is worse
value than removing the code.

**What survives, and why:**

- `OverpassSlotBudget.sync` — DEC-V3 said to remove it too "if nothing else
  needs it", and something does: it is the only way `isUnlimited` is ever set,
  so deleting it would take the whole unlimited-instance path with it.
- `overpass-status.ts` — a declared package entry point in
  `config/tsdown.config.ts`, i.e. deliberate public API for a consumer that
  wants to read a status page itself. It simply has no in-repo consumer now.
