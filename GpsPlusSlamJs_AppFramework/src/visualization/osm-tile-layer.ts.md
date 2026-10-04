# osm-tile-layer.ts

## Purpose

The OpenStreetMap raster basemap as a Leaflet layer: the one call that
applies the tile-policy values of `utils/osm-tiles.ts`. Moved from the
RecorderApp's `ui/map-osm-base.ts` on 2026-10-01 with the summary map's
shell (`summary-map-shell.ts`, DEC-H3), which draws the basemap itself.

## Public API

- `addOsmTileLayer(map: L.Map): L.TileLayer` - creates the OSM tile layer
  (`OSM_TILE_URL`, `OSM_TILE_ATTRIBUTION`, `maxZoom: OSM_TILE_MAX_ZOOM`),
  adds it to `map` and returns it for the caller's cleanup.

## Invariants & assumptions

- The layer is on the map when the call returns.
- The URL, attribution and ceiling are written down once, in
  `utils/osm-tiles.ts` (`tests/repo-config/osm-tile-url-copies.test.js`).
- Leaflet is a static import: consumers that must not ship Leaflet to every
  page import this (or `summary-map-shell.ts`) dynamically.

## Examples

```ts
const map = L.map(container).setView([lat, lng], 15);
const tiles = addOsmTileLayer(map);
// ...
tiles.remove();
```

## Tests

- `osm-tile-layer.test.ts`: one layer with the policy values, added to the
  map and returned.
- Consumers: `summary-map-shell.test.ts`; the Recorder's
  `preview-map.test.ts`, `map-browser.test.ts` and `summary-map.test.ts`.
