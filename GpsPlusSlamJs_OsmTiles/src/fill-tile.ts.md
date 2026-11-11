# `fill-tile.ts`

## Purpose

One tile fill as the serial queue consumer runs it: re-check the store, the
failure record and the daily cap; fetch the client's exact query from the
Overpass operators in turn; keep the bytes as sent; refuse a partial
answer; never replace newer data with older; gzip; store; list in the
manifest.

## Public API

- `fillTile(message, deps)` - returns a `FillOutcome`:
  - `filled` (with endpoint, `osmBase`, raw and stored bytes, attempts);
  - `present` (a `fill` for a stored tile), `fresh` (a `refresh` for a tile
    younger than 30 days), `backoff`, `cap` - no request was sent;
  - `failed` - every attempt failed; a failure record is written;
  - `kept-newer` - the answer's data is not newer than the stored tile's.
- `FillDeps` - `bucket`, `fetchImpl`, `now`, `userAgent`, `endpoints`,
  `dailyUpstreamCap`, optional `attemptTimeoutMs` (200 s), `wallBudgetMs`
  (12 min), `gzip` (default true).
- `operatorOf(endpoint)` - the endpoint's registrable domain; a 429 from one
  operator skips its other endpoints.
- `compressGzip(bytes)` - native `CompressionStream("gzip")`.
- `REFRESH_AGE_MS` (30 days), `TILE_CACHE_CONTROL` (one day).

## Invariants & assumptions

- **The query is the client's own**:
  `buildTileQuery(cellToBoundingBox(cell), 180, OVERPASS_SELECT_KEYS)` from
  `gps-plus-slam-osm/source`, so a stored tile is byte for byte what the
  browser's direct race would have received and the client needs no second
  parser.
- **Serial, never a race**: one operator after another, a long per-attempt
  timeout, a real `User-Agent`. The browser races because a user waits; the
  proxy must not multiply load on volunteer-run servers.
- **Every upstream request is counted before it is sent**, so a fill the
  runtime kills mid-way still counts against the daily cap.
- **No `JSON.parse`**: completeness is decided by `checkOverpassBody` from
  the head and tail only.
- **The border rule of the static pre-built tiles does not apply**: a live
  proxy stores whatever the operators answer for the cell's bounding box,
  exactly as the client would have fetched it; there is no cut along a
  country border.
- Timestamps are compared as text; ISO-8601 UTC strings of one format sort
  chronologically.

## Tests

`fill-tile.test.ts`: a fill end to end with stored metadata and manifest
line, the gunzipped bytes equal to the sent bytes, each early outcome
sending no request, 429 skipping an operator, a `remark` answer refused and
the next operator used, failure backoff and its clearing, the cap stopping
mid-fill, the attempt timeout, kept-newer, a refresh replacing an older
tile, and gzip switched off.
