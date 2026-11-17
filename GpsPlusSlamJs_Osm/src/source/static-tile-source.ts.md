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
    finite. `maxWaitMs` bounds the wait for each answer's headers, not its
    body, so a tile is handed over (served or raced) at most
    `max(maxWaitMs, requestTimeoutMs) + requestTimeoutMs` after it was
    asked for: 105 s on the defaults, for a body that began just before
    the wait's end, which the second term covers. With a wait shorter
    than the per-request limit the two terms are the first read of a
    stored file and its re-read past the browser cache, neither of which
    is part of the fill wait.
  - `requestTimeoutMs?` - the limit on each request to the host, body
    included; default the race's `DEFAULT_REQUEST_TIMEOUT_MS` (45 s).
    RangeError unless positive and finite. Requests of the fill wait (the
    fill ask, the read after a 200, each poll and its re-read) must also
    have their response headers before the wait's end; their bodies keep
    this limit alone.
- `fetchTile(tile, { signal?, speculative? })` - `OsmDataSource`.
- `sourceId` - `static:<host>`; `attribution` - the OSM attribution.
- `OSM_TILES_BASE_URL` - the project's own host
  (`https://osm-tiles.csutil.workers.dev`); used only when a consumer passes it.
  Every city loader of the workspace does: OsmDemo's worker (unless
  `tiles=off`), the Tour Editor's globe city worker (through the Globe
  core's `staticTilesBaseUrl`) and the design system's globe lab worker.

## Behaviour

1. `GET {origin}/osm/v{schema}/{tile}.json.gz`.
   - 200: the body is the Overpass answer (the host sends `Content-Encoding`,
     either the operator's gzip or the edge's own compression of a raw file,
     so the browser has decoded it). It must be a complete answer: JSON, an
     object, an `elements` array and no top-level `remark` with content
     (an empty or whitespace one counts as none; Overpass's mark
     of a partial answer after a timeout or memory abort; the host stores an
     operator's gzip answer on its head alone, so the reader is where a
     partial one is caught; the host must therefore never be deployed
     ahead of this check, `GpsPlusSlamJs_OsmTiles/README.md` "Deploy
     order"). A bad file is read once more with
     `cache: "no-cache"`, since the browser's HTTP cache may hold an older
     copy than the host now stores (the host replaces bad tiles); a good
     copy is served, a 404 continues as below. That re-read is allowed
     once per tile per session, speculative reads included: a tile that
     stays bad (its replace is bounded to once a day) would otherwise cost
     two downloads on every read. The allowance is spent only once the
     re-read produced a verdict (an answer, a host error, a network error
     or no headers in time); a re-read the fill wait had no time left for,
     or one the caller aborted, leaves it for the next read of the tile.
     Since it is not claimed before the attempt, it is not a hard bound:
     concurrent reads of one bad tile can each download it twice. That is
     narrow in the documented wiring, where `CachingSource` shares one read
     per tile among its callers.
     When the file is still bad, one `console.warn` line names why (a
     remark bounded to one line of 200 characters; once per tile per
     session, speculative reads included, since a ring warm often reaches
     a tile first and the cache in front keeps its result, so no later
     read may see the tile), the tile goes to `fallback` with no refusal
     remembered,
     and the host is sent one fire-and-forget
     `POST /report/v{schema}/{tile}?etag=<the ETag of the copy judged>` (the
     re-read's, or the first read's when the re-read failed) per tile per
     session, speculative reads included for the same reason as the
     warning, since a tile never reported is never replaced (none without
     an ETag; a failed report is ignored; the host bounds reports per
     address and per day). The tile is marked reported before the report is
     sent, so a report the host answers with 429 (its per-IP or global
     report limit) is not retried in that session: a wave of distinct bad
     tiles loses most of its reports. That is deliberate, since the race
     keeps every such tile usable and a retry would only add load to a host
     that is already limiting. The host
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
     fits inside `maxWaitMs` from the start (a look that would start
     with nothing left is not made). With no wait left before the ask
     (`maxWaitMs` 0) no fill is asked for and the tile goes to
     `fallback`, as when the wait is spent.
   - 503 `{status:"backoff"}`: this cell's fill failed, was killed or is
     running; the tile goes to `fallback` with no refusal remembered, since
     it says nothing about other cells.
   - anything else (403 origin not allowed, 429 per-IP limit, 503 daily cap,
     backlog full, queue down): refusal.
3. Refusal, network error, a request past `requestTimeoutMs`, or the wait
   spent: the tile goes to
   `fallback` with the caller's options, at once, and no fill is asked for
   during `refusalMemoryMs`. After an HTTP answer (a refusal, a host error)
   or the fill wait running out, stored files are still read in that time:
   a refused fill says nothing about the files the host already holds.
   After NO answer (a network error, or no headers within
   `requestTimeoutMs`), the host is not asked anything during
   `refusalMemoryMs`, reads and speculative reads included: every tile
   goes straight to `fallback`, without even the read of step 1. Any HTTP
   answer that arrives meanwhile (a request that was already running when
   another got none) clears that memory: the host has just answered. The
   converse holds too: a request that gets no answer only sets the memory
   when it was sent at or after the host's last answer (`lastAnswerAt`). A
   read that gives up at 45 s after another request was answered at 2 s
   says nothing newer about the host, so it is only a refusal of its tile
   (inside the source the failure is a `NoAnswer` carrying its send time).
   A header timer of the fill wait (the wait
   running out before an answer began) is `FillWaitSpent` inside the
   source and counts as the wait spent, not as no answer: the host had
   answered that tile's earlier requests.
   - **Worst case for a host that never answers** (a black-holed address):
     the first tile waits one `requestTimeoutMs` (45 s on the defaults)
     before its race, and every later tile goes to the race at once until
     `refusalMemoryMs` (10 min) has passed, when one tile pays the 45 s
     again. The memory is per `StaticTileSource` instance: a consumer that
     builds one per load (the globe city worker) pays it once per load.
     Before this, each cold tile paid the 45 s, one after another.

**Read-only fetches** do step 1 only: a `speculative` fetch (a ring warm,
nobody waiting on it) and any fetch while fills are refused. A speculative
fetch also sends no refresh. It does make the re-read past the browser
cache and send the one report of a bad stored file, both once per tile per
session, as above: a ring warm is often the only read that sees a tile.

**Timings.** `transportMs` is the delivering read's own round trip; the time
from the first ask to that read (the wait for the host's fill, polls
included) is `slotWaitMs`, so a queued fill never reads as a slow download.

## Invariants

- **Never both at once.** The fallback starts only after the last request to
  the host has settled; a test records the host's call count at the moment the
  race begins and asserts nothing reaches the host after it.
- **The fallback runs at most once per tile**, and a tile is always delivered
  by exactly one of the two (property test over random host answers).
- **No answer, no further asks** for `refusalMemoryMs`: a test times one
  read out and asserts the next, different tile reaches the race with no
  request to the host (so the memory is the host's, not the tile's); a
  refused fill, a host error, a body that broke off after its headers and
  a poll cut by the fill wait keep stored files readable, and an answer
  arriving after another request's failure clears the memory.
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
  body included, composed with the caller's signal, which still aborts
  hard). A request of the fill wait must also have its response headers by
  the wait's end, an absolute deadline (`started + maxWaitMs`), so the
  re-read past the browser cache inside a poll cannot overrun it; a timer
  aborts a per-request controller and is cleared once the headers arrive.
  With at least `requestTimeoutMs` left no timer is set, as that limit
  already bounds the headers. A re-read that fails for any reason but an
  abort (no time left, no headers in time, a host error) leaves the first,
  bad copy to decide: the tile is raced and reported with that copy's
  ETag, and no refusal is remembered. A caller abort during the re-read
  is rethrown as an abort, with no report, no race and no refusal. "No
  time left" is its own error inside the source (`NoWaitLeft`, nothing
  sent), apart from a `HostDeclined` (the host answered with a status
  that is neither 200 nor 404). Outside the re-read a `NoWaitLeft` still
  counts as a refusal, exactly like a `HostDeclined`, although nothing
  was learnt about the host: the caller backs off the same way.
  The body is not cut at the wait's end: fills take 30-75 s against the
  60 s wait, so a tile often appears near its end, and a dense tile's body
  takes seconds at low bandwidth (3.1 MB at 2 Mbps is about 12 s); cutting
  it would read as a refusal and send a tile the host just stored to the
  race. No request starts once the deadline has passed (a sleep can
  overshoot): that is `NoWaitLeft`, never a negative timer. The first
  read of a stored file is not part of the fill wait and keeps the plain
  limit. The default
  is the race's per-attempt deadline: the host sends stored bytes only, so
  at equal bandwidth it never needs longer than the race, which also waits
  for the operator to compute the answer.
  - **Why the read keeps 45 s and has no shorter limit of its own**
    (checked 2026-11-16): the limit covers the body, and the only numbers
    at hand are body sizes and bandwidths: a stored tile of 4.3 MB was read
    in 2.3 s on a good connection, and 3.1 MB at 2 Mbps takes about 12 s,
    so 4.3 MB at 1 Mbps takes about 34 s. A shorter limit would cut dense
    tiles on slow phone links and send them to the race, which then
    downloads the same bytes from a slower operator. Nothing measured
    supports a lower value, and the no-answer memory above already bounds
    the black-holed case to one limit per memory. A separate, shorter limit
    on the headers alone would be the safer cut, but needs a measurement of
    the host's header latency on phones first.
- A body that fails while it is read (`text()` rejecting: the stream
  dropped, or a dense tile ran past `requestTimeoutMs` on a slow link) is
  a `HostDeclined`: the refusal is remembered, but the host sent its
  headers, so it is not taken for unreachable and stored files of other
  tiles are still read. Taking it for no answer sent every tile of a load
  to the race for the whole memory, on exactly the slow links where the
  host is the faster path. A caller abort during the read stays an abort.
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
  JSON, a partial answer (`remark`) re-read past the browser cache, raced
  and reported once with its ETag, the re-read past the cache made once
  per tile per session (speculative reads included), an empty or
  whitespace remark served, the refused remark logged on one bounded line,
  a fresh copy on the re-read served with
  no report, a speculative bad read reporting the tile once with no second
  report from a later foreground read, a body without
  `elements`, the request time limit (a stalled host and a body that stalls
  after its headers go to the race; the caller's abort still aborts; the
  default is the race's deadline; each answer of the fill wait beginning
  within what is left of it, at several splits of headers, body and wait
  left; a late tile's body read whole past the wait's end but within the
  per-request limit; a poll's re-read bounded by the same deadline, and a
  re-read cut by it still reporting the first copy with no refusal; a
  caller abort during the re-read staying an abort with no report; a caller abort during the body read staying an abort with no race and no refusal; a
  re-read with no wait left, or one the caller aborted, leaving the
  allowance for the next read; a re-read failing with a host error, a
  network error or no headers in time spending it; the warning once per
  tile, speculative reads included; header
  timers only below the request limit; no
  request after an overshooting sleep, which still counts as a refusal so
  the next fetch only reads; no fill asked with no wait left), a host that
  does not answer (a timed-out read or a network error skips the host for
  the next tiles, speculative ones too, until the memory passes; a refused
  fill, a 500 and a poll cut by the fill wait do not; a failure of a
  request sent before another request's answer does not either, while one
  sent after the last answer does), the poll timings (`slotWaitMs` for the wait), the bounded wait,
  the memory expiring, abort, the base URL check, and the property test.
- `city/city-data.test.ts`: `createCityTileSource` with and without the option.
