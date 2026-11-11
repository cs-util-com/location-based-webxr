# `routes.ts`

## Purpose

The Worker's HTTP surface. Stored tiles and the manifest are open to
everyone; only the fill endpoint, the one door to the operators' budget, is
guarded.

## Public API

- `handleRequest(request, deps)` with `RouteDeps { env, now }`:
  - `GET|HEAD /osm/v3/<cell>.json.gz` - the stored file with
    `Content-Encoding: gzip`, `Access-Control-Allow-Origin: *`,
    `Cache-Control: public, max-age=86400`, `ETag`, `Last-Modified`, `X-Osm-Base` (data age) and
    `X-Filled-At`. Read from R2 on every request. A missing or invalid cell is a `404` with `no-store`,
    **never cached**, so a tile filled a minute later is visible at once.
  - `GET /osm/v3/manifest.tsv` - the list of filled cells (five minutes).
  - `POST /fill/v3/<cell>` (and its `OPTIONS` preflight), in this order:
    1. origin allowlist (`https://gps.csutil.com`, any
       `https://<name>.csutil.workers.dev`, `http://localhost` and
       `127.0.0.1` on any port), else `403`;
    2. cell validation, else `400`;
    3. per-IP rate limit, else `429` with `Retry-After: 60`;
    4. tile present: `200 {status:"present", url}`; older than 30 days:
       a refresh is queued and the answer is `200 {status:"refreshing", url}`;
    5. failure backoff: `503` with `Retry-After` until the record allows;
    6. daily cap spent: `503` with `Retry-After` until the UTC day ends;
    7. otherwise queued: `202 {status:"queued", url}`, `Retry-After: 15`.
  - `GET /` - what the service is, the ODbL notice naming the OpenStreetMap
    contributors, the manifest and the source repository.
  - Anything else `404`; a wrong method `405`.
- `isAllowedFillOrigin(origin)`, `dailyUpstreamCap(env)`,
  `DEFAULT_DAILY_UPSTREAM_CAP` (300).

## Invariants & assumptions

- **The origin check is a hotlink guard only**: any non-browser client can
  send any `Origin`. The bounds that hold against a determined caller are
  the per-IP limit (approximate: Cloudflare counts per location) and the
  daily cap the serial consumer keeps.
- Every refusal answers at once and enqueues nothing, so the client falls
  back to its direct Overpass race without waiting.
- `encodeBody: "manual"` passes the stored gzip through; without it the
  runtime would compress the body a second time under the same header.
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

`routes.test.ts`: every route and refusal, the pass-through bytes, the
uncached 404, CORS for both sides, look-alike origins, and a property that
only the three listed origin shapes are ever allowed.
