# `source/static-tile-source.ts`

## Purpose

An `OsmDataSource` that reads a fetch tile from a static tile host (the
`osm-tiles` Worker, see `GpsPlusSlamJs_OsmTiles/README.md`) and hands it to a
`fallback` source (the direct Overpass race) whenever the host cannot serve
it. Opt-in through `createCityTileSource(store, { staticTiles: { baseUrl } })`;
the library default is off.

## Public API

- `new StaticTileSource(options)`:
  - `baseUrl` - the host's origin; only its origin is used. RangeError when it
    is not an http(s) URL.
  - `fallback` - the source a tile goes to when the host says no.
  - `fetchImpl?`, `now?`, `sleepImpl?` - seams for tests.
  - `pollIntervalMs?` (4 s), `maxWaitMs?` (60 s), `refusalMemoryMs?`
    (10 min), `refreshAfterMs?` (30 days) - RangeError when negative or not
    finite.
  - `requestTimeoutMs?` - the limit on each request to the host, body
    included; default the race's `DEFAULT_REQUEST_TIMEOUT_MS` (45 s).
    RangeError unless positive and finite.
- `fetchTile(tile, { signal?, speculative? })` - `OsmDataSource`.
- `sourceId` - `static:<host>`; `attribution` - the OSM attribution.
- `OSM_TILES_BASE_URL` - the project's own host
  (`https://osm-tiles.csutil.workers.dev`); used only when a consumer passes it.

## Behaviour

1. `GET {origin}/osm/v{schema}/{tile}.json.gz`.
   - 200: the body is the Overpass answer (the host sends `Content-Encoding`,
     either the operator's gzip or the edge's own compression of a raw file,
     so the browser has decoded it). It must be a complete answer: JSON, an
     object, an `elements` array and no top-level `remark` (Overpass's mark
     of a partial answer after a timeout or memory abort; the host stores an
     operator's gzip answer on its head alone, so the reader is where a
     partial one is caught). A bad file goes to `fallback` with no refusal
     remembered, and the host is sent one fire-and-forget
     `POST /report/v{schema}/{tile}?etag=<the response's ETag>` per tile per
     session (none without an ETag; a failed report is ignored). The host
     verifies the stored bytes itself before deleting anything
     (`GpsPlusSlamJs_OsmTiles/src/verify-tile.ts.md`).
     A complete answer is parsed with `parseOverpassJson`, exactly like a
     race answer. `fetchedAt` is the answer's `timestamp_osm_base` (the
     data's age, so an old file never looks freshly fetched), else now.
     When the answer's `timestamp_osm_base` is older than `refreshAfterMs`,
     the host is sent one fire-and-forget `POST /fill` for that tile per
     session (not while fills are refused, never for a speculative read; a
     failed ask is ignored) and the old file is served.
   - 404: not filled yet, step 2 - unless the fetch is read-only (below),
     then the tile goes to `fallback` with no refusal remembered.
   - anything else: refusal.
2. `POST {origin}/fill/v{schema}/{tile}`.
   - 200 (already present): read once more.
   - 202 (queued): the JSON body's `ahead` counts the fills queued before
     this one. Above 0 the tile goes to `fallback` at once with no refusal
     remembered (each fill takes 30-75 s, so the wait would run out). At 0
     (or unsaid) read again every `pollIntervalMs` while the next look still
     fits inside `maxWaitMs` from the start.
   - 503 `{status:"backoff"}`: this cell's fill failed, was killed or is
     running; the tile goes to `fallback` with no refusal remembered, since
     it says nothing about other cells.
   - anything else (403 origin not allowed, 429 per-IP limit, 503 daily cap,
     backlog full, queue down): refusal.
3. Refusal, network error, a request past `requestTimeoutMs`, or the wait
   spent: the tile goes to
   `fallback` with the caller's options, at once, and no fill is asked for
   during `refusalMemoryMs`. Stored files are still read in that time: a
   refused fill says nothing about the files the host already holds.

**Read-only fetches** do step 1 only: a `speculative` fetch (a ring warm,
nobody waiting on it) and any fetch while fills are refused. A speculative
fetch also sends no refresh.

**Timings.** `transportMs` is the delivering read's own round trip; the time
from the first ask to that read (the wait for the host's fill, polls
included) is `slotWaitMs`, so a queued fill never reads as a slow download.

## Invariants

- **Never both at once.** The fallback starts only after the last request to
  the host has settled; a test records the host's call count at the moment the
  race begins and asserts nothing reaches the host after it.
- **The fallback runs at most once per tile**, and a tile is always delivered
  by exactly one of the two (property test over random host answers).
- **An abort is rethrown**, never turned into a fallback, and does not mark the
  host as refusing.
- **`speculative` is forwarded** to the fallback untouched.
- The 60 s default wait is sized by measurement: cold fills (Heidelberg,
  Meggen, Eifel, Cologne) took 32-75 s from the queue to the stored file on
  2026-11-11. The direct race for the same four tiles from a residential
  German connection the same evening (two rounds, run one at a time)
  succeeded in 30.5, 35.0, 72.5, 125.5 and 136.1 s and failed in three of
  eight runs after 52.6-146.9 s, so a 60 s wait with nothing queued ahead is
  not slower than the race it replaces. The race depends on Overpass load,
  so the comparison is provisional.
- **Every request to the host has a time limit** (`requestTimeoutMs`,
  composed with the caller's signal, which still aborts hard). The default
  is the race's per-attempt deadline: the host sends stored bytes only, so
  at equal bandwidth it never needs longer than the race, which also waits
  for the operator to compute the answer.
- Defensive: unknown statuses are refusals; a bad stored file goes to the
  race and is reported, with no refusal (it says nothing about other
  tiles); the response bodies of 404s, refusals and fire-and-forget asks are
  cancelled, and a rejected `cancel()` is ignored.

## Example

```ts
const source = new CachingSource(
  new StaticTileSource({
    baseUrl: "https://osm-tiles.csutil.workers.dev",
    fallback: new OverpassSource({ userAgent: "my-app (example.org)" }),
  }),
  store,
);
```

## Tests

- `static-tile-source.test.ts`: the stored tile, fill-and-poll, the fill
  answering 200, fallback on 429 / 503 / 403 / 500 with the refusal remembered,
  stored tiles still read while refused, speculative fetches read-only, a
  queued fill with others ahead skipped, a cell in backoff not refusing
  other tiles, the refresh ask for old data (once,
  and never for young data or a speculative read, a failed ask harmless),
  bodies whose `cancel()` rejects, an unreachable host, a file that is not
  JSON, a partial answer (`remark`) raced and reported once with its ETag, a
  body without `elements`, the request time limit (a stalled host goes to
  the race; the caller's abort still aborts; the default is the race's
  deadline), the poll timings (`slotWaitMs` for the wait), the bounded wait,
  the memory expiring, abort, the base URL check, and the property test.
- `city/city-data.test.ts`: `createCityTileSource` with and without the option.
