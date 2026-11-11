# `routes.ts`

## Purpose

The Worker's HTTP surface. Stored tiles and the manifest are open to
everyone; only the fill endpoint, the one door to the operators' budget, is
guarded.

## Public API

- `handleRequest(request, deps)` with `RouteDeps { env, now, cache? }`:
  - `GET|HEAD /osm/v3/<cell>.json.gz` - the stored file with
    `Content-Encoding: gzip`, `Access-Control-Allow-Origin: *`,
    `Cache-Control: public, max-age=86400`, `ETag`, `Last-Modified`, `X-Osm-Base` (data age) and
    `X-Filled-At`. Read from R2 on every request. A missing or invalid cell is a `404` with `no-store`,
    **never cached**, so a tile filled a minute later is visible at once.
  - `GET /osm/v3/manifest.tsv` - the stored cells, listed from R2
    (`manifest.ts`), five minutes in the edge cache (`deps.cache`).
  - `POST /fill/v3/<cell>` (and its `OPTIONS` preflight), in this order:
    1. origin allowlist (`https://gps.csutil.com`, any
       `https://<name>.csutil.workers.dev`, `http://localhost` and
       `127.0.0.1` on any port), else `403`;
    2. cell validation, else `400`;
    3. per-IP rate limit, else `429` with `Retry-After: 60`;
    4. tile present: `200 {status:"present", url}`; older than 30 days:
       one refresh is queued (not when the cell is already pending, nor when
       the backlog is full: the old file still serves) and the answer is
       `200 {status:"refreshing", url}`;
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
  - `GET /` - what the service is, the ODbL notice naming the OpenStreetMap
    contributors, the manifest and the source repository.
  - Anything else `404`; a wrong method `405`.
- `isAllowedFillOrigin(origin)`; `dailyUpstreamCap(env)` (the
  `DAILY_UPSTREAM_CAP` var, 300 when unset or invalid).

## Invariants & assumptions

- **The origin check is a hotlink guard only**: any non-browser client can
  send any `Origin`. The bounds that hold against a determined caller are
  the per-IP limit (approximate: Cloudflare counts per location) and the
  daily cap the serial consumer keeps.
- Every refusal answers at once and enqueues nothing, so the client falls
  back to its direct Overpass race without waiting.
- `encodeBody: "manual"` passes the stored gzip through; without it the
  runtime would compress the body a second time under the same header.
  Node's `Response` ignores the option, so the test checks the init the
  route hands to `Response` rather than the bytes.
- **Custom domain later is configuration only**: the paths are the R2 keys,
  so a domain on the Worker (a `routes` entry in `wrangler.toml`) or on the
  bucket itself serves the same URLs; the client's base URL option changes,
  the code does not.
- **No Cache API in front of R2**, measured on the deployed Worker: `caches.default`
  kept the stored gzip as plain content and gzipped it again on every hit
  (3,116,006 bytes went out as about 3,123,200; a client decoding once got
  gzip, not JSON), also when the hit was re-wrapped with `encodeBody:
"manual"`. R2 alone served the 3 MB Cologne tile in 1.5-2.0 s to one
  client in Germany, the same as the cache. Browsers still cache for a day.
  An edge cache belongs with a custom domain (a Cache Rule), measured again
  there.

## Tests

`routes.test.ts`: every route and refusal, the pass-through bytes and
`encodeBody: "manual"`, the uncached 404, the manifest from the stored
tiles and its edge cache, the backlog (`ahead`, busy, stale markers
ignored, the var, one message per cell, one refresh per old tile), a queue
failure answered 503 with CORS, a killed fill answered backoff, CORS for
both sides, look-alike origins, and a property that only the three listed
origin shapes are ever allowed.
