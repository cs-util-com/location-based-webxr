# GpsPlusSlamJs_OsmTiles

The `osm-tiles` Cloudflare Worker: OpenStreetMap city data as static files,
one per H3 resolution-7 cell, filled lazily the first time an app asks for
a cell and then served to everyone from R2.

- `GET /osm/v3/<cell>.json.gz` - the cell's Overpass `out geom` JSON
  (gzip as the operator sent it, or uncompressed and compressed by the edge),
  open to every origin (`Access-Control-Allow-Origin: *`).
- `POST /fill/v3/<cell>` - ask for a missing cell (app origins only; per-IP
  limit; global daily cap; a short backlog, beyond which it answers busy at
  once). A serial queue consumer fetches the exact query the browser would
  have sent, from the public Overpass instances one after another, asking
  for gzip, and stores the bytes as sent.
- `POST /report/v3/<cell>?etag=` - a viewer found the stored tile bad (app
  origins only; per-IP limit; daily verify cap). The consumer checks the
  stored bytes itself and deletes only a bad tile; a report alone deletes
  nothing.

`v3` is the query schema version (`OVERPASS_SCHEMA_VERSION`); every path
follows it.

The client side is the `StaticTileSource` of `GpsPlusSlamJs_Osm`, an opt-in
of `createCityTileSource`; on any refusal or delay it falls back to the
direct Overpass race at once.

Data (c) OpenStreetMap contributors, ODbL 1.0. The files are an unmodified
copy of the Overpass answer, and each one carries the licence notice in its
headers (`Link: <https://www.openstreetmap.org/copyright>; rel="license"`
and `X-Data-License`).

There is deliberately no list of stored cells. Fills follow viewers' GPS, so
a stored cell can be the area around someone's home; a public list with
dates would show every such place in one request, while without it finding
an unknown place takes a probe per cell.

## Files

- `src/osm-tiles-worker.ts` - the entry (routes + queue consumer).
- `src/routes.ts` - the HTTP surface and the fill endpoint's guards.
- `src/fill-tile.ts` - one fill; `src/verify-tile.ts` - one verify of a
  reported tile; `src/fill-state.ts` - daily caps, failure backoff, pending
  markers, verified memos; `src/overpass-body-check.ts` - completeness
  without parsing; `src/body-window.ts` - bounded head and tail reads of a
  (gzip) body; `src/tile-cell.ts` - cell validation, keys and paths;
  `src/bindings.ts` - binding shapes.

## Develop, test, deploy

```bash
pnpm test           # format + build the OSM package + typecheck + unit
pnpm run test:unit
pnpm run deploy     # wrangler deploy of THIS Worker only
```

`wrangler.toml` here is the Worker's whole configuration: the R2 bucket
`osm-tiles`, the queue `osm-tiles-fill` (producer and serial consumer), the
per-IP rate limiter and the vars (`DAILY_UPSTREAM_CAP`,
`MAX_PENDING_FILLS`, `DAILY_VERIFY_CAP`, `USER_AGENT`). The
site Worker and the root `wrangler.toml` are unrelated.

`.github/workflows/deploy-osm-tiles.yml` deploys this Worker on a push to
`main` that touches this package or the Overpass query, and on demand. It
needs the repository secret `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare
Workers" token template, scoped to the account in `wrangler.toml`); without
it the job skips. Until then deploys are manual (`pnpm run deploy`).

**Deploy order: the client first, then the Worker.** The Worker stores an
operator's gzip answer on its inflated head alone, so a partial answer
(Overpass's top-level `remark` after a timeout) can be stored, and only the
reader catches it: `StaticTileSource` and `OverpassSource` in the Osm
package refuse a `remark`. Every app that points at the host must run a
client with that check before this Worker serves gzip-stored tiles;
otherwise an older client takes a partial tile as the whole tile and keeps
it in its cache. A merge that changes both deploys them from the same push,
in no fixed order, so after such a merge deploy the Worker by hand (the
workflow's manual run) once the site's deploy has finished.

The Worker is served on `osm-tiles.<account>.workers.dev`. A custom domain
is a configuration change: a `routes` entry here and the client's base URL
(`OSM_TILES_BASE_URL` in the Osm package's `static-tile-source.ts`). It goes
on the Worker only, never on the R2 bucket. The main reason: a bucket
domain serves every object in it, and the bucket also holds the Worker's
own `state/` objects (fill failures, the daily counters, the verify memos
and verifying markers), which would become public. It would also serve
the files without the Worker's licence headers, CORS and data age.
