# Summary Map Component

## Purpose

Leaflet-based 2D map displayed in the session summary panel after a recording ends. Shows the recorded GPS path and reference point locations.

**User Feedback Reference:** Issue #4 (2026-01-27) - "In the final report screen when I clicked 'Stop' I would like to be able to see the map with the path the user walked."

## Public API

### `createSummaryMap(container, data): SummaryMapInstance | null`

Creates an interactive Leaflet map in the given container.

**Parameters:**

- `container: HTMLElement | null` - DOM element to render into
- `data: SummaryMapData` - Path and marker data

**Returns:**

- `SummaryMapInstance` with `destroy()`, `expand()`, `collapse()`, `isExpanded()` methods, or `null` if creation failed

**Error conditions:**

- Returns `null` if container is null
- Returns `null` if both `rawGpsPath` and `fusedPath` are empty

### Color Constants (exported)

```typescript
export const RAW_GPS_COLOR = '#ffff00'; // Yellow — raw GPS polyline
export const FUSED_PATH_COLOR = '#00ffff'; // Cyan — fused path polyline
export const REF_POINT_COLOR = '#ff6b6b'; // Red — reference point markers
export const ALIGNMENT_SNAPSHOT_COLOR = '#ff0000'; // Red — alignment snapshot polyline
```

### Types

```typescript
// Imported from types/geo-types.ts (re-exported)
import type { GpsCoord, RawGpsSample } from '../types/geo-types';
import type { RefPointMarkerInput } from './draw-ref-point-markers';

interface SummaryMapData {
  rawGpsPath: RawGpsSample[]; // Yellow polyline + per-event accuracy circles (when accuracy is set)
  fusedPath: GpsCoord[]; // Cyan polyline
  referencePoints: RefPointMarkerInput[]; // each carries a `timestamp` for prior/current classification
  startTime?: number; // recording start (epoch ms) for classification; defaults to 0
  alignmentSnapshots?: GpsCoord[]; // Red polyline from alignment-update snapshots
}

interface SummaryMapInstance {
  destroy: () => void; // Cleanup Leaflet resources
  expand: () => void; // Enter fullscreen mode
  collapse: () => void; // Return to inline mode
  isExpanded: () => boolean; // Current fullscreen state
}
```

## Visual Elements

| Element                 | Color                                        | Description                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw GPS Polyline        | `#ffff00` (yellow)                           | Raw GPS readings from device                                                                                                                                                                                                                                                            |
| Raw GPS Accuracy Circle | `#ffff00` (yellow, ~12% fill)                | Per-event horizontal accuracy (radius = `latLongAccuracy` in meters); skipped when accuracy is missing or non-positive                                                                                                                                                                  |
| Fused Path Polyline     | `#00ffff` (cyan)                             | GPS+SLAM aligned positions                                                                                                                                                                                                                                                              |
| Reference Point Markers | `VIS_COLORS` red `#ff6b6b` / green `#00ff00` | Drawn by the recorder-owned [draw-ref-point-markers.ts](draw-ref-point-markers.ts) helper — the SAME renderer the live/replay minimaps use via [ref-point-map-markers.ts](ref-point-map-markers.ts.md) (2026-07-05). Red `📍 current`, green `📌 prior` by `timestamp` vs. `startTime`. |
| Alignment Snapshots     | `#ff0000` (red)                              | Polyline connecting snapshot positions                                                                                                                                                                                                                                                  |
| Tile Layer              | OpenStreetMap                                | Standard map tiles                                                                                                                                                                                                                                                                      |

## Invariants & Assumptions

1. **Leaflet CSS must be loaded** - The component assumes `leaflet.css` is included in the page head
2. **Container must have dimensions** - The container needs explicit width/height or the map won't render properly
3. **Coordinates in WGS84** - Lat/lng values are standard GPS coordinates
4. **Center on final position** - Map centers on the FINAL user position of the recording (last raw GPS reading, falling back to the last fused position) at `INITIAL_ZOOM`. It deliberately does NOT fit bounds over all elements: scattered far-away prior reference points used to zoom the recording down to a useless dot. Ref-point markers are drawn but never extend the view.
5. **Safe cleanup** - `destroy()` is idempotent (safe to call multiple times)
6. **XSS-safe popups** - Reference point name popups use DOM `textContent` (not innerHTML), so names containing HTML-like characters are safely escaped. Ref markers are NOT drawn by the shared framework overlay module (which is ref-point-agnostic) but by the recorder-owned [draw-ref-point-markers.ts](draw-ref-point-markers.ts) helper, shared with the live/replay overlay so both maps render ref points identically.
7. **Fullscreen toggle** - `expand()`/`collapse()` are idempotent and safe after `destroy()`. Fullscreen uses `fixed inset-0 z-[60]` CSS. Leaflet `invalidateSize()` + re-center on the final position (`setView` preserving the current zoom) called after each transition (300ms delay for CSS reflow). Buttons (`data-testid="btn-map-expand"` / `data-testid="btn-map-collapse"`) are created dynamically inside the container and cleaned up on `destroy()`.

## Examples

### Basic Usage

```typescript
import { createSummaryMap } from './summary-map';

const container = document.getElementById('map-container');
const mapData = {
  rawGpsPath: [
    { lat: 50.0, lng: 8.0 },
    { lat: 50.001, lng: 8.001 },
  ],
  fusedPath: [],
  referencePoints: [
    { lat: 50.001, lng: 8.001, name: 'Entrance', timestamp: 1700000000000 },
  ],
  startTime: 1699999999000,
};

const map = createSummaryMap(container, mapData);

// Later, when panel is hidden:
if (map) {
  map.destroy();
}
```

### Integration with Session Summary

The map is automatically created in `showSessionSummary()` when the `#summary-map-container` element exists in the DOM:

```html
<div
  id="summary-map-container"
  class="relative w-full h-48 rounded-lg overflow-hidden bg-gray-800"
>
  <!-- Leaflet map + fullscreen buttons inserted here -->
</div>
```

## Tests

Unit tests in `summary-map.test.ts` cover:

- Map creation with valid data
- Null container handling
- Empty GPS path handling
- Single-point GPS path
- Yellow polyline for raw GPS
- Cyan polyline for fused path
- Reference point marker creation
- XSS safety of reference point name popups
- Final-position centering behavior
- Safe destroy/cleanup
- Fullscreen expand/collapse (CSS class toggling, invalidateSize, idempotency)
- Fullscreen button visibility toggling
- Button cleanup on destroy

Run tests:

```bash
npm run test:unit -- src/ui/summary-map.test.ts
```

## Related Files

- [session-summary.ts](session-summary.ts) - Parent component that hosts the map
- [index.html](../../index.html) - Contains the `#summary-map-container` element
- [gps-event-markers.ts](../visualization/gps-event-markers.ts) - 3D visualization using same color scheme

## Dependencies

- `leaflet` - Map library (CDN CSS + npm package)
- `../utils/logger` - Logging utility
