# `source/osm-data-source.ts`

## Purpose

The `OsmDataSource` seam — the abstraction that keeps the Overpass decision
reversible, and the only interface everything downstream consumes.

## Public API

- `OsmDataSource` — `{ attribution, sourceId, fetchTile(tile, signal?) }`.
- `OsmTileResult` — `{ tile, features, fetchedAt, sourceId, schemaVersion, skipped, osmBaseTimestamp?, timings? }`.
- `OsmTileTimings` — what ONE DELIVERY of a tile cost.
  - `servedBy` — `"network" | "cache" | "joined" | "stale-on-rate-limit"`. Four
    values rather than two because a dedup joiner and a stale-on-rate-limit
    answer are neither a fetch nor a hit, and filing them as one of those makes
    a breakdown misattribute the wait.
  - `slotWaitMs` — queued behind `maxConcurrent` before any work began. Its own
    field because folded into transport it reads as a slow server, and dropped
    it reads as time that never happened.
  - `transportMs` — bytes in hand: the HTTP round trip, or the OPFS `store.get`.
    **Spans the retry loop including backoff sleeps**, which is why `attempts`
    sits beside it.
  - `decodeMs` — `JSON.parse` of those bytes.
  - `parseMs` — `parseOverpassJson`. **Genuinely `0` on a cache hit**, because
    the blob already holds features.
  - `attempts` — network attempts; `1` means no retry.
  - `storeMs?` — the awaited cache write, present only when one happened.
  - `joinedMs?` — a dedup joiner's whole wall wait. Present only when
    `servedBy === "joined"`; the other durations are 0 there, so a joiner's sum
    is `joinedMs + probeMs`. It is NOT `transportMs`: a joiner's wait spans
    somebody else's transport AND decode AND parse.
  - `probeMs?` — the cache READ that preceded this delivery and did not serve
    it. Present on a miss, on a stale hit, **and on a join** — the joiner pays a
    full read before it discovers there is a request to join, and until
    2026-08-12 that cost was dropped rather than carried. On a large blob a
    probe is the second-largest term on those paths.
- `OSM_ATTRIBUTION` — `"© OpenStreetMap contributors"`.

## Invariants & assumptions

- **Everything downstream depends on this interface, never on `OverpassSource`.**
  That is what makes swapping in a self-hosted instance, a PMTiles build, or a
  pre-baked server index a configuration change rather than a rewrite. Given
  what the measurements in `../testdata/README.md` show about public-instance
  latency, that escape hatch is not hypothetical.
- **`OsmTileResult` is structured-cloneable and JSON-serialisable.** It crosses
  a storage boundary (the blob store) and, in the consumer's bridge, a Web
  Worker boundary. A round-trip test pins this.
- **`fetchedAt` describes when the DATA was retrieved, not when it was read.**
  A cached tile keeps its original timestamp, so a consumer showing "OSM data
  from March 2026" is telling the truth.
- **`attribution` lives on the source, not as a module constant**, because a
  self-hosted or blended source may owe different credit. Rendering it is an
  ODbL obligation, not a courtesy.
- `schemaVersion` travels with the result so a cache can reject non-equivalent
  entries even if its key scheme changes.
- `skipped` is always present. Parser rejections are counted, never silently
  discarded.

## Implementations

`OverpassSource` (network), `FixtureSource` (tests/offline), `CachingSource`
(decorator over any of them).

## Tests

`fixture-source.test.ts` proves interchangeability: the same assertions pass
through a fixture source and through the caching decorator, and a result
survives a JSON round-trip unchanged APART FROM `timings`, which is per-delivery
and must not persist — `tile-timings.test.ts` pins that both ways.

## `timings` — a delivery, never the tile

Added 2026-08-11 for the click-path stage breakdown
(`GpsPlusSlamJs_Docs/docs/2026-08-11-0717-osm-demo-click-path-stage-timing-plan.md`
§6.1). Optional and additive: a source that does not measure omits it, and
**absent is not zero** — `parseMs: 0` on a cache hit is a true and useful fact
about the warm path, while an absent object means nobody looked.

Four rules the type cannot enforce, each pinned by `tile-timings.test.ts`:

- **`CachingSource` strips it before `store.put`.** The write serialises the
  whole result, so a `timings` left on it lands in OPFS and is replayed on every
  later hit — the warm path would report the originating network's
  `transportMs` forever, and parse (the term the plan is hunting) would be
  measured on the wrong path entirely.
- **A dedup joiner gets its own.** `InFlightRequests` hands N callers one
  delivery; a caller that arrived 200 ms before a 60 s fetch settled spent
  200 ms, and reporting the originator's cost overstates the fetch stage by
  however many callers happened to collide.
- **The cache WRITE is charged to the miss that paid for it.** It is `await`ed
  before `fetchTile` resolves, so it is on the click path whether or not anyone
  thinks of it as fetching — but only added when the inner source measured at
  all, or an unmeasured source would acquire a partial object of zeros.
- **Two clocks.** `now` stays epoch (it is `fetchedAt`, user-visible
  provenance); durations use a separate injectable monotonic clock, because
  `Date.now()` stepping backwards on an NTP correction inside a tens-of-seconds
  fetch would produce a negative duration in a breakdown whose job is to add up.
