# GpsPlusSlamJs_OsmTiles

The `osm-tiles` Cloudflare Worker: OpenStreetMap city data as static files,
one per H3 resolution-7 cell, filled lazily the first time an app asks for
a cell and then served to everyone from R2.

- `GET /osm/v3/<cell>.json.gz` - the cell's Overpass `out geom` JSON, gzip,
  open to every origin (`Access-Control-Allow-Origin: *`).
- `POST /fill/v3/<cell>` - ask for a missing cell (app origins only; per-IP
  limit; global daily cap; a short backlog, beyond which it answers busy at
  once). A serial queue consumer fetches the exact query the browser would
  have sent, from the public Overpass instances one after another, and
  stores the bytes as sent.

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
- `src/fill-tile.ts` - one fill; `src/fill-state.ts` - daily cap, failure
  backoff, pending markers; `src/overpass-body-check.ts` - completeness without parsing; `src/tile-cell.ts` - cell validation and keys;
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
`MAX_PENDING_FILLS`, `USER_AGENT`). The
site Worker and the root `wrangler.toml` are unrelated.

`.github/workflows/deploy-osm-tiles.yml` deploys this Worker on a push to
`main` that touches this package or the Overpass query, and on demand. It
needs the repository secret `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare
Workers" token template, scoped to the account in `wrangler.toml`); without
it the job skips. Until then deploys are manual (`pnpm run deploy`).

The Worker is served on `osm-tiles.<account>.workers.dev`. A custom domain
is a configuration change: a `routes` entry here and the client's base URL
(`OSM_TILES_BASE_URL` in the Osm package's `static-tile-source.ts`).
