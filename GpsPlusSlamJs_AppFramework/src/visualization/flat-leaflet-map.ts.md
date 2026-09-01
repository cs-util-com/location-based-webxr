# flat-leaflet-map.ts

## Purpose

A plain, toggleable 2D Leaflet map — the flat counterpart to `LeafletMapOverlay`. Where `LeafletMapOverlay` embeds Leaflet into the THREE.js scene via `CSS3DObject` for in-AR display, `createFlatLeafletMap` renders straight into a regular DOM container (e.g. a "show map" panel over an AR view, or a standalone map page). Reuses `buildMapData`/`drawMapData` for the user-position dot — the same routine `LeafletMapOverlay` and the session-summary map use — and mirrors `LeafletMapOverlay`'s method names (`setGpsPosition`, `render`, `toggle`/`show`/`hide`/`isVisible`) so an app can switch between the two overlay styles without changing call sites. Adds waypoint markers colored by status via `waypoint-marker-status.ts`.

## Public API

### `createFlatLeafletMap(container, options?)`

| Param       | Type                     | Default | Description                                    |
| ----------- | ------------------------ | ------- | ----------------------------------------------- |
| `container` | `HTMLElement \| null`    | —       | Map container; returns `null` if `null`         |
| `options`   | `FlatLeafletMapOptions`  | `{}`    | Configuration overrides (see below)             |

### `FlatLeafletMapOptions`

| Field           | Type                        | Default | Description                        |
| --------------- | --------------------------- | ------- | ----------------------------------- |
| `tileServerUrl` | `string`                    | OSM URL | Tile server URL template            |
| `onTileError`   | `(error: unknown) => void`  | —       | Callback when tile loading fails    |

### Key Methods (`FlatLeafletMapInstance`)

| Method                                          | Description                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `setGpsPosition(lat, lon)`                       | Center/pan the map to a GPS fix (first call sets zoom, later calls pan only)        |
| `render(data: MapData)`                          | Draw the user-position dot via the shared `drawMapData` routine                     |
| `setWaypoints(markers: WaypointMarkerViewModel[])` | Replace the waypoint marker layer wholesale, colored by status                    |
| `toggle()` / `show()` / `hide()` / `isVisible()` | Visibility control — starts hidden                                                  |
| `resize()`                                       | Re-measure the container (Leaflet mis-sizes tiles if hidden when created/toggled)   |
| `getLeafletMap()`                                | Returns the underlying `L.Map`, or `null` after `destroy()`                         |
| `destroy()`                                      | Remove the map and all layers; idempotent                                            |

## Invariants & Assumptions

- Starts hidden (`container.style.display = "none"`); `show()` schedules a `requestAnimationFrame` resize since Leaflet mis-measures tiles created while hidden.
- `setGpsPosition` only sets zoom on the **first** fix; subsequent calls pan without touching zoom, so a user's manual zoom mid-session isn't fought.
- `setWaypoints` fits the map bounds to the waypoints only if no GPS fix has centered the map yet (avoids sitting on the `[0, 0]` fallback before the first fix arrives).
- No hardcoded CSS class names on markers (`className: ""`) to avoid coupling to external stylesheets — matches `LeafletMapOverlay`'s convention.
- `destroy()` is idempotent — safe to call more than once.

## Examples

```ts
import { createFlatLeafletMap } from './flat-leaflet-map';
import { computeMarkerViewModels } from './waypoint-marker-status';

const map = createFlatLeafletMap(document.getElementById('map-container'));
map?.setGpsPosition(49.99, 8.24);
map?.setWaypoints(computeMarkerViewModels(waypoints, visitedIds, nextId));
map?.show();
```

## Tests

- `flat-leaflet-map.test.ts` — Leaflet mocked (same pattern as `leaflet-map-overlay.test.ts`): null container, tile layer creation, GPS centering/panning, waypoint marker placement + status coloring + wholesale replacement, bounds-fit-before-first-fix, user-position rendering, visibility toggling, resize, destroy idempotency, tile error callback.
