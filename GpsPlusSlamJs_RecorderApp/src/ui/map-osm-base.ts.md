# `map-osm-base.ts`

## Purpose

The recorder's shared path and view style tokens for its Leaflet views:
[preview-map.ts](preview-map.ts), [map-browser.ts](map-browser.ts) and
[summary-map.ts](summary-map.ts) - polyline thickness/opacity, initial zoom,
and `fitBounds` padding - so the screens stay visually consistent.

**The basemap layer moved to the framework** (2026-10-01):
`addOsmTileLayer` is now
`gps-plus-slam-app-framework/visualization/osm-tile-layer`
([sidecar](../../../GpsPlusSlamJs_AppFramework/src/visualization/osm-tile-layer.ts.md)),
because the summary map's shell moved there too
([summary-map-shell.ts.md](../../../GpsPlusSlamJs_AppFramework/src/visualization/summary-map-shell.ts.md),
DEC-H3, Tour Viewer authoring plan 2026-09-28-0953 §3.3) and draws the
basemap itself. The views import it from there. The three tile-policy values
were already in `gps-plus-slam-app-framework/utils/osm-tiles` since
2026-09-22.

## Public API

- `PATH_POLYLINE_WEIGHT`, `PATH_POLYLINE_OPACITY` — stroke style applied to
  every GPS path polyline (raw, fused, alignment snapshots).
- `INITIAL_ZOOM` — zoom passed to `setView` before `fitBounds` runs (the
  summary map hands it to the shell as `initialZoom`).
- `FIT_BOUNDS_PADDING` — pixel padding for `fitBounds`; prevents markers and
  accuracy circles from being clipped at the edges.

## Invariants & assumptions

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
import { addOsmTileLayer } from 'gps-plus-slam-app-framework/visualization/osm-tile-layer';

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
  down the constant values; the tile layer's options are pinned by the
  framework's `visualization/osm-tile-layer.test.ts`.
