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
    (10 min) - RangeError when negative or not finite.
- `fetchTile(tile, { signal?, speculative? })` - `OsmDataSource`.
- `sourceId` - `static:<host>`; `attribution` - the OSM attribution.
- `OSM_TILES_BASE_URL` - the project's own host
  (`https://osm-tiles.csutil.workers.dev`); used only when a consumer passes it.

## Behaviour

1. `GET {origin}/osm/v{schema}/{tile}.json.gz`.
   - 200: the body is the Overpass answer (the host sends its stored gzip
     with `Content-Encoding: gzip`, so the browser has decoded it). It is
     parsed with `parseOverpassJson`, exactly like a race answer. `fetchedAt`
     is the host's `X-Filled-At` (when the data left Overpass), else now.
   - 404: not filled yet, step 2.
   - anything else: refusal.
2. `POST {origin}/fill/v{schema}/{tile}`.
   - 200 (already present): read once more.
   - 202 (queued): read again every `pollIntervalMs` while the next look
     still fits inside `maxWaitMs` from the start.
   - anything else (403 origin not allowed, 429 per-IP limit, 503 daily cap):
     refusal.
3. Refusal, network error, malformed JSON or the wait spent: the tile goes to
   `fallback` with the caller's options, at once, and the host is not asked
   again for `refusalMemoryMs` (every tile goes straight to the fallback in
   that time).

## Invariants

- **Never both at once.** The fallback starts only after the last request to
  the host has settled; a test records the host's call count at the moment the
  race begins and asserts nothing reaches the host after it.
- **The fallback runs at most once per tile**, and a tile is always delivered
  by exactly one of the two (property test over random host answers).
- **An abort is rethrown**, never turned into a fallback, and does not mark the
  host as refusing.
- **`speculative` is forwarded** to the fallback untouched.
- The 60 s default wait is sized by measurement: three cold fills (dense
  Cologne, mid Meggen, rural Eifel) took 36-56 s from the queue to the stored
  file on 2026-11-11. A shorter wait gives up on fills that would have
  succeeded, at the cost of a race the host was about to make unnecessary.
- Defensive: unknown statuses are refusals; a body that is not JSON is a
  refusal; the response bodies of 404s and refusals are cancelled.

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
  an unreachable host, a malformed file, the bounded wait, the memory expiring,
  abort, the base URL check, and the property test.
- `city/city-data.test.ts`: `createCityTileSource` with and without the option.
