# `utils/osm-tiles.ts`

## Purpose

The one place the OpenStreetMap raster basemap is described: tile URL,
attribution, maximum zoom.

## Public API

- `OSM_TILE_URL` — `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. A Leaflet
  URL template; pass it straight to `L.tileLayer`.
- `OSM_TILE_ATTRIBUTION` — the HTML credit the OSM tile usage policy requires.
- `OSM_TILE_MAX_ZOOM` — `19`.

No functions, no error modes. Three constants.

## Invariants & assumptions

- **No `{s}` subdomain sharding, deliberately.** That form was a workaround for
  HTTP/1.1's per-host connection limit; HTTP/2 multiplexes one connection, so
  the shards buy nothing and the OSM tile usage policy discourages them.
  `tests/repo-config/osm-tile-url-copies.test.js` matches BOTH spellings
  precisely so the deprecated one cannot come back in a new copy.
- **Deep-imported, never through the `/utils` barrel** (DEC-H3). The barrel
  feeds `src/index.ts`'s `export *`, so adding it there would put three
  basemap constants on the package's root export surface. Consumers write
  `from 'gps-plus-slam-app-framework/utils/osm-tiles'`.
- **It is therefore a tsdown ENTRY.** `config/tsdown.config.ts` lists it. A deep
  import of a module that is not an entry passes `tsc`, lint and vitest and
  fails only in the browser; `framework-deep-imports-are-built.test.js` is the
  guard that catches the omission.
- **Attribution is owed by whoever draws the tiles, not by whoever draws the
  widget.** `LeafletMapOverlay` and the recorder's maps hand
  `OSM_TILE_ATTRIBUTION` to Leaflet's own control; `GpsPlusSlamJs_OsmDemo`
  switches that control off and renders its own, so it carries the same credit
  through its `OSM_ENTRY`. Both discharge the same obligation.
- **A different tile provider is a DECISION, not a duplicate.**
  `LeafletMapOverlay` still takes a `tileServerUrl` option and only defaults to
  `OSM_TILE_URL`; a consumer pointing at their own tile server is expected and
  the guard does not object to it.

## Examples

```ts
import {
  OSM_TILE_URL,
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_MAX_ZOOM,
} from 'gps-plus-slam-app-framework/utils/osm-tiles';

L.tileLayer(OSM_TILE_URL, {
  attribution: OSM_TILE_ATTRIBUTION,
  maxZoom: OSM_TILE_MAX_ZOOM,
}).addTo(map);
```

## Tests

`tests/repo-config/osm-tile-url-copies.test.js` at the workspace root: the tile
URL appears in exactly one source file, its matcher is unit-tested against both
spellings and against an ordinary `openstreetmap.org` link, and the canonical
file is asserted to actually define it — otherwise deleting this module would
make the guard pass with zero copies.

The values themselves have no behaviour to test. What could break is a consumer
failing to apply them, which their own suites cover.
