# `fill-tile.ts`

## Purpose

One tile fill as the serial queue consumer runs it: re-check the store, the
failure record and the daily cap; fetch the client's exact query from the
Overpass operators in turn, asking for gzip; keep the bytes as sent; refuse
a bad answer; never replace newer data with older; store. Nothing is
compressed, and nothing beyond a bounded head is decompressed, in the
Worker (CPU). The fill writes no list of stored tiles; there is none
(`routes.ts.md`).

## Public API

- `fillTile(message, deps)` - returns a `FillOutcome`:
  - `filled` (with endpoint, `osmBase`, stored bytes, the decoded size
    `rawBytes`, attempts);
  - `present` (a `fill` for a stored tile), `fresh` (a `refresh` for a tile
    younger than 30 days), `backoff`, `cap` - no request was sent;
  - `failed` - every attempt failed; the failure record names the last
    attempt's reason;
  - `kept-newer` - the answer's data is not newer than the stored tile's;
  - `missing` - a `replace` for a cell with no stored tile; no request;
  - `too-soon` - a `replace` within 24 h of the cell's last one; no
    request.
- A `replace` message (a reported tile the verify cannot judge bad)
  refetches a stored tile whatever its age and stores the answer even when
  its data is not newer. It does not raise the cell's bad count: a report
  is no evidence the tile is bad, and a forged one must not lengthen the
  backoff a genuinely bad tile of the cell earns later. It is bounded
  instead by a per-cell gap (`REPLACE_MIN_GAP_MS`, 24 h; within it the
  outcome is `too-soon` and nothing is sent), written up front so a
  killed replace still counts, and by its share of the day's upstream
  budget (`dailyReplaceCap`, a third of `dailyUpstreamCap` by default):
  each replace request counts in `upstreamRequests` and in
  `replaceRequests`, and a spent share stops a replace (`cap`, also
  mid-way) while ordinary fills still run. The failure record is written
  up front as for any fill. A success clears it and the cell's verified
  memo; a failure keeps the stored tile (a replace never deletes) and
  names the reason.
- `FillDeps` - `bucket`, `fetchImpl`, `now`, `userAgent`, `endpoints`,
  `dailyUpstreamCap`, optional `dailyReplaceCap` (default
  `defaultReplaceCap(dailyUpstreamCap)`, a third), `attemptTimeoutMs`
  (200 s), `wallLimitMs` (14 min).
- `FillOutcome` - the outcome above with its attempts and sizes; one JSON
  log line per fill.
- `REFRESH_AGE_MS` (30 days) - also read by the fill endpoint.

## Invariants & assumptions

- **Stored as the operator encoded it.** The request sends
  `Accept-Encoding: gzip` and `encodeResponseBody: "manual"` (a workerd
  option; Node ignores it), so the runtime hands over the bytes as sent:
  - `Content-Encoding: gzip`: the body must start with the gzip magic
    `1f 8b`; only its head is inflated (the first 16 KB in, at most 2 KB
    out: `body-window.ts`, about 0.3-0.4 ms at any tile size) for
    `checkOverpassHead` (`{`, a valid `timestamp_osm_base`, not in the
    future). Size bounds first, for free: more than
    `MAX_TILE_GZIP_BYTES` (20 MiB) of gzip, or a trailer ISIZE (the
    decoded size modulo 2^32, the last four bytes, little-endian) above
    `MAX_TILE_DECODED_BYTES` (150 MiB), is refused as `too-large`. Stored
    byte for byte with `contentEncoding: gzip`, `storedAs: upstream-gzip`,
    `checked: head`, and the ISIZE as `rawBytes`. ISIZE is the gzip's own
    claim: a crafted stream can understate it, and the verify's decoded
    limit (`readBodyEnds`) is the backstop for what slips past. A gzip
    answer's tail is not checked here, so a partial one (a top-level
    `remark`) can be stored and only the reader refuses it: this Worker
    must never be deployed ahead of a client that does (see the README,
    "Deploy order"). **The tail is not checked
    here**: a gzip answer with a top-level `remark` (a partial answer) can
    be stored. The client rejects such a body, falls back to the direct
    race and reports it; the verify job (`verify-tile.ts`) then deletes it.
    Inflating the whole answer would cost about 1.3-7 ms per MB raw, past
    the Free plan's 10 ms for any dense tile.
  - No encoding (or `identity`): the full head and tail check
    (`checkOverpassBody`), stored raw (`storedAs: raw`, `checked: full`,
    `rawBytes`); the edge compresses it per client when served. Longer
    than `MAX_TILE_DECODED_BYTES`: `too-large`. That check cannot fire
    in practice: the body is buffered whole before it, and an isolate has
    128 MB of memory, so an uncompressed answer anywhere near 150 MiB
    ends the invocation first (the fill is then a killed run, backed off
    by its record written up front). Operators answer gzip when asked, so
    a raw answer of that size is not expected.
  - A `gzip` label on bytes without the magic that start with `{` (a hop
    decoded the body and kept the header): treated as raw, with the full
    check, and stored raw.
  - Any other encoding, a `gzip` label on other bytes without the magic,
    or a head that does not inflate: refused as `encoding`, next operator.
- The head inflate is a deliberate exception to "the fill decompresses
  nothing": without it the fill would lose `osmBase`, which carries the
  never-older rule, the refresh age and `X-Osm-Base`, and an operator's
  gzipped error page would be stored. Its cost is bounded by constants.
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
- **The failure record is written before the first attempt** (count + 1,
  `retryAt` from the backoff, reason `unfinished`) and cleared on success
  or on `kept-newer`. The runtime can kill a fill mid-way (measured once on
  the Free plan: `exceededCpu` at 325 ms) and the queue does not retry it
  (`max_retries = 0`); a record written only after the attempts left
  nothing, and every later request queued the same download again. Now a
  kill is backoff, and the endpoint answers `503` at once.
- **No attempt can run past the consumer's wall limit**: an attempt starts
  only while `elapsed + attemptTimeoutMs <= 14 min`, leaving a minute of the
  15-minute invocation for storing the tile.
- An operator's 429 skips that operator's other endpoints (the endpoints'
  registrable domain is the operator).
- **No `JSON.parse`**: completeness is decided by `checkOverpassBody` (or
  `checkOverpassHead` for gzip) from the head and tail only.
- **The border rule of the static pre-built tiles does not apply**: a live
  proxy stores whatever the operators answer for the cell's bounding box,
  exactly as the client would have fetched it; there is no cut along a
  country border.
- Timestamps are compared as text; ISO-8601 UTC strings of one format sort
  chronologically.

## Tests

`fill-tile.test.ts`: a fill end to end with stored metadata (gzip asked
for, manual body encoding, an uncompressed answer stored raw), a gzip
answer stored byte for byte with its head-checked metadata, the timestamp
read from a large gzip answer's head, a gzipped error page, an invalid
timestamp in a gzip head, a false gzip label and an unasked encoding
refused, a gzip-labelled body starting with `{` checked whole and stored
raw (a partial one refused), a gzip answer refused by its trailer's ISIZE
and one by its length, the ISIZE stored as `rawBytes` and counted, a gzip
answer with a tail remark stored (the reader's check), each early outcome sending no
request, 429 skipping an operator, a `remark` answer refused and the next
operator used, failure backoff and its clearing, the record written before
the first attempt (a killed fill backs off), the reason named without a
second count, no attempt started past the wall limit, a future data
timestamp refused, the cap stopping mid-fill, the attempt timeout,
kept-newer, a refresh replacing an older tile, and the replace: stored
when not newer with the memo forgotten, the bad count left alone, a second
replace within 24 h sending nothing, its share of the budget (counted in
both counters, a third by default, stopping mid-way while a fill still
runs), a failed refetch keeping the tile, nothing for a missing tile, the
daily cap.
