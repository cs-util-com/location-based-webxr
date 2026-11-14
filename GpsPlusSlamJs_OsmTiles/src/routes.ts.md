# `routes.ts`

## Purpose

The Worker's HTTP surface. Stored tiles are open to everyone; the fill
endpoint, the one door to the operators' budget, and the report endpoint,
the one door to deleting a tile, are guarded. There is no list of stored
tiles (below).

## Public API

- `handleRequest(request, deps)` with `RouteDeps { env, now }`:
  - `GET|HEAD /osm/v<schema>/<cell>.json.gz` - the stored file. A gzip
    object (an operator's gzip answer, or a tile of the earlier fill, which
    compressed itself) is sent with `Content-Encoding: gzip` and
    `encodeBody: "manual"`; a raw object as a plain response without
    `Content-Encoding`, which the edge compresses per client (gzip, br or
    zstd; its ETag may then reach the browser weak, `W/"..."`). Both with
    `Access-Control-Allow-Origin: *`,
    `Cache-Control: public, max-age=86400`, `ETag`, `X-Osm-Base` (data age), and the licence
    notice: `Link: <https://www.openstreetmap.org/copyright>; rel="license"`
    and `X-Data-License: ODbL-1.0; (c) OpenStreetMap contributors` (both
    exposed to scripts). The fill time is not sent, so neither is
    `Last-Modified` (R2's upload time is the fill time to the second).
    Read from R2 on every request. A missing or invalid cell is a `404` with `no-store`,
    **never cached**, so a tile filled a minute later is visible at once.
  - `POST /fill/v<schema>/<cell>` (and its `OPTIONS` preflight), in this order:
    1. origin allowlist (`https://gps.csutil.com`, any
       `https://<name>.csutil.workers.dev`, `http://localhost` and
       `127.0.0.1` on any port), else `403`;
    2. cell validation, else `400`;
    3. per-IP rate limit, else `429` with `Retry-After: 60`. The key is
       `rateLimitKey(ip)`: an IPv4 address as is, an IPv6 address by its
       /64 (`2001:db8:1:2::/64`), since one host is given a whole /64, and
       a v4-mapped IPv6 address by its IPv4 address;
    4. tile present: `200 {status:"present", url}`; older than 30 days:
       one refresh is queued and the answer is
       `200 {status:"refreshing", url}`. Not when the cell is in failure
       backoff, the day's upstream cap is spent, the cell is already
       pending, or the backlog is full: the old file still serves, so the
       answer stays `present`;
    5. failure backoff: `503 {status:"backoff"}` with `Retry-After` until
       the record allows. Checked before the backlog: a running fill and a
       killed one both have a record and cannot be told apart, so a POST
       during a live fill also answers backoff (that viewer races, as
       without the host); clients read backoff as about this cell only;
    6. the cell already pending: `202 {status:"queued", url, ahead}` without
       a second message;
    7. daily cap spent: `503 {status:"cap"}` until the UTC day ends;
    8. backlog full (`ahead >= MAX_PENDING_FILLS`, default 4):
       `503 {status:"busy", ahead}`, `Retry-After: 60`, nothing queued;
    9. otherwise a pending marker and a queue message:
       `202 {status:"queued", url, ahead}`, `Retry-After: 15`. `ahead` is
       the number of other fills queued or running; the client waits only
       when it is 0. A queue (or marker) failure is `503 {status:"unavailable"}`
       with CORS, and the marker is removed again.
  - `POST /report/v<schema>/<cell>?etag=<ETag read>` (and its preflight) -
    a viewer found the stored tile bad (not JSON, no elements array, or a
    top-level `remark`). In this order:
    1. the fill endpoint's origin allowlist (`403`), cell validation
       (`400`) and per-IP limit, under its own key `report:<key>` (the
       same `rateLimitKey`) so reports
       and fills do not share one budget (`429`);
    2. no `etag`: `400 {status:"invalid-etag"}`;
    3. no tile: `200 {status:"missing"}`;
    4. the named ETag (weak form accepted) is not the stored one, i.e. the
       tile was already replaced: `200 {status:"stale"}`;
    5. the verify memo names the stored ETag:
       - `started` less than 15 minutes ago (a verify may still run):
         `202 {status:"checking"}`;
       - `started` longer ago (the runtime killed that verify, and would
         again), or `good` less than 7 days ago (the verify cannot settle
         this report): a refetch, below;
       - `good` and older: verified again, as if there were no memo;
    6. a verify of this same object already open (a fresh
       `state/verifying/<cell>` marker naming this ETag):
       `202 {status:"checking"}` and nothing sent, so a burst of reports
       of one tile costs one message;
    7. the day's verifies spent (`DAILY_VERIFY_CAP`, default 50):
       `503 {status:"cap"}` until the UTC day ends;
    8. other cells' open verifies at `MAX_OPEN_VERIFIES` (8):
       `503 {status:"busy"}`, `Retry-After: 60`, nothing sent, so forged
       reports spread over many cells cannot fill the serial queue in
       front of the fills;
    9. otherwise the verifying marker (with the ETag), then a `verify`
       message to the serial queue: `202 {status:"checking"}`; a queue
       failure removes the marker again and is `503 {status:"unavailable"}`.
       The consumer clears the marker when the verify ends; a marker older
       than 15 minutes (a lost or killed run) no longer counts.

    The refetch (`replace`) is bounded like a fill: the cell's failure
    backoff `503 {status:"backoff"}`; the cell already pending
    `202 {status:"replacing"}` without a second message; the day's upstream
    cap `503 {status:"cap"}`; a full backlog `503 {status:"busy"}`;
    otherwise a pending marker and a `replace` message,
    `202 {status:"replacing"}`. The consumer counts it as a bad tile, so
    the cell's backoff grows with every replace and survives its success,
    and it never deletes: the old file serves until the new one is
    stored.
    **A report never deletes anything itself.** The consumer verifies the
    stored bytes (`verify-tile.ts`) and deletes only a bad tile. Deleting on
    report would let any script with a forged `Origin` delete every stored
    tile for one request each, and each refill costs the volunteer
    operators; counting reports from distinct IPs is defeated by cheap IP
    rotation. A verify costs Worker CPU only, never an upstream request,
    and is bounded by the per-IP limit and the daily cap; a good tile
    survives any number of reports.

  - `GET /` - what the service is (its paths built from the schema version,
    as the routes are), the ODbL notice naming the OpenStreetMap
    contributors, and the source repository.
  - `<schema>` is the query schema version (`TILE_SCHEMA_VERSION` in
    `tile-cell.ts`); a path of another version is an ordinary `404`.
  - Anything else `404`; a wrong method `405`.
- `rateLimitKey(ip)` - the limiter key above; an address it cannot read
  is kept as it came, never folded into a shared key.
- `isAllowedFillOrigin(origin)`; `dailyUpstreamCap(env)` (the
  `DAILY_UPSTREAM_CAP` var, 300 when unset or invalid); `dailyVerifyCap(env)`
  (the `DAILY_VERIFY_CAP` var, 50 when unset or invalid).

## Invariants & assumptions

- **No list of stored tiles.** A fill follows a viewer's GPS, so a stored
  cell (about 5 km2) can be the area around someone's home. A public list
  with dates would show every such place in one request; without it,
  finding an unknown place takes one probe per cell, millions of them. The
  old `/osm/v3/manifest.tsv` path is an ordinary `404`, and the licence
  notice travels on every tile instead.

- **The origin check is a hotlink guard only**: any non-browser client can
  send any `Origin`. The bounds that hold against a determined caller are
  the per-IP limit (approximate: Cloudflare counts per location; per /64
  for IPv6) and the
  daily cap the serial consumer keeps.
- Every refusal answers at once and enqueues nothing, so the client falls
  back to its direct Overpass race without waiting.
- `encodeBody: "manual"` passes the stored gzip through; without it the
  runtime would compress the body a second time under the same header.
  Node's `Response` ignores the option, so the test checks the init the
  route hands to `Response` rather than the bytes.
- **A custom domain goes on the Worker only, never on the bucket**: a
  `routes` (or `custom_domain`) entry in `wrangler.toml`, after which the
  client's base URL option changes and the code does not. The main
  reason: a bucket domain serves every object in the bucket, and the
  bucket also holds the Worker's `state/` objects (`failures/`, `daily`,
  `verified/`, `verifying/`, `pending/`), which would become public. A
  domain on the R2 bucket would also serve the tiles without this Worker: no licence
  headers, no CORS, no `X-Osm-Base`, and the stored gzip without the
  manual-encoding handling, so the paths being the R2 keys does not make
  the two equivalent.
- **No Cache API in front of R2**, measured on the deployed Worker: `caches.default`
  kept the stored gzip as plain content and gzipped it again on every hit
  (3,116,006 bytes went out as about 3,123,200; a client decoding once got
  gzip, not JSON), also when the hit was re-wrapped with `encodeBody:
"manual"`. R2 alone served the 3 MB Cologne tile in 1.5-2.0 s to one
  client in Germany, the same as the cache. Browsers still cache for a day.
  An edge cache belongs with a custom domain (a Cache Rule), measured again
  there.

## Tests

`routes.test.ts`: the limiter key for IPv4, IPv6 spellings of one /64,
v4-mapped addresses and unreadable input, with a property that two
addresses share a key exactly when their first 64 bits match; every route and refusal, the pass-through bytes and
`encodeBody: "manual"`, the uncached 404, the licence headers on GET and
HEAD, no fill time or `Last-Modified` sent, the manifest path answering 404, the fill path and service text
following the schema version (another version 404), the backlog (`ahead`, busy, stale markers
ignored, the var, one message per cell, one refresh per old tile, none in
failure backoff or past the daily cap), a queue
failure answered 503 with CORS, a killed fill answered backoff, CORS for
both sides, look-alike origins, a property that only the three listed
origin shapes are ever allowed, a raw tile served without `Content-Encoding`
or manual encoding, and the report endpoint: one verify queued for the named
object and nothing deleted, a weak ETag matched, stale, missing, verified,
cap, every guard (its own limiter key), the preflight, a queue outage
(its marker removed), a good memo answered with a replace (and an old one
verified again), a `started` memo answered checking or, once old, with a
replace, the replace's bounds, one message per open verify of an object, a stale
marker sending again, the open-verify bound, and
a property that no sequence of reports, run through the real verify and
refetch steps over days with the upstream up or down, removes a good
stored tile.
