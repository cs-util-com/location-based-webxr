# `map-osm-base.ts`

## Purpose

Shared OSM base-map setup and path style tokens for the two Leaflet views in
the recorder app: [preview-map.ts](preview-map.ts) and
[summary-map.ts](summary-map.ts). Centralises the OSM tile URL/attribution,
zoom limit, polyline thickness/opacity, initial zoom, and `fitBounds` padding
so both screens stay visually consistent.

Scope is intentionally narrow: only values/helpers that are identical in both
views live here. View-specific concerns (fullscreen toggle, multi-path/ref
markers, resize delays) stay in their respective files.

## Public API

- `addOsmTileLayer(map): L.TileLayer` — creates and attaches the standard OSM
  tile layer; returns it so callers can track the layer for cleanup.
  - **The three tile-policy values are NO LONGER declared here** (2026-09-22).
    `OSM_TILE_URL`, `OSM_TILE_ATTRIBUTION` and `OSM_TILE_MAX_ZOOM` come from
    `gps-plus-slam-app-framework/utils/osm-tiles`; see
    [that sidecar](../../../GpsPlusSlamJs_AppFramework/src/utils/osm-tiles.ts.md)
    for why. Importing them from there is what a fourth map view should do too.
- `PATH_POLYLINE_WEIGHT`, `PATH_POLYLINE_OPACITY` — stroke style applied to
  every GPS path polyline (raw, fused, alignment snapshots).
- `INITIAL_ZOOM` — zoom passed to `setView` before `fitBounds` runs.
- `FIT_BOUNDS_PADDING` — pixel padding for `fitBounds`; prevents markers and
  accuracy circles from being clipped at the edges.

## Invariants & assumptions

- `addOsmTileLayer` calls `.addTo(map)` synchronously; the returned tile
  layer is already on the map.
- All exported values are constants and safe to reuse across map instances.
- **What stays here is the recorder's LOOK, and that is the boundary.**
  `PATH_POLYLINE_WEIGHT`, `PATH_POLYLINE_OPACITY`, `INITIAL_ZOOM` and
  `FIT_BOUNDS_PADDING` are this app's styling choices, with no second consumer
  and no contract behind them. The tile URL, attribution and zoom ceiling were
  the opposite — an agreement with the tile operator — which is why only those
  three moved. A boundary survey that same day looked at moving the whole file
  and rejected it for exactly this reason.

## Examples

```ts
const map = L.map(container).setView([lat, lng], INITIAL_ZOOM);
const tileLayer = addOsmTileLayer(map);
layers.push(tileLayer); // for cleanup
// …draw paths…
map.fitBounds(bounds, { padding: FIT_BOUNDS_PADDING });
```

## Tests

- Behavior is exercised through the consumers'
  [preview-map.test.ts](preview-map.test.ts) and
  [summary-map.test.ts](summary-map.test.ts), which both assert the OSM tile
  URL and the `fitBounds` padding.
- Direct unit coverage in [map-osm-base.test.ts](map-osm-base.test.ts) pins
  down the tile-layer options and the constant values so a drift in either
  view would be caught even if the consumer-level assertions are loosened.
