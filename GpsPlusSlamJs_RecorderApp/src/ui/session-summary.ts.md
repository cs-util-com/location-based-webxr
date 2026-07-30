# Session Summary Panel

## Purpose

Displays recording statistics, error logs, and validation data after a recording session ends. This implements a **TERMINAL state** per the Application State Machine - users cannot restart from this panel; they must reload the page for a new recording.

This component addresses user feedback Issues #3 and #4:

- **Issue #3**: Recording restart was broken/confusing → Solution: Make SUMMARY terminal, no restart button
- **Issue #4**: Missing summary/report screen after stop → Solution: Show comprehensive session stats

## Public API

### Types

```typescript
interface SessionSummaryCallbacks {
  onNewRecording: () => void; // Called when user clicks "New Recording" - should reload page
  onViewLogs?: () => void; // Called when user clicks "View Logs" (optional)
}

interface SessionSummaryData {
  duration: { startTime: number; endTime: number };
  gpsEventCount: number;
  refPointCount: number;
  imageCount: number;
  depthSampleCount: number;
  errors: string[];
  firstGps: GpsCoord | null; // from types/geo-types
  lastGps: GpsCoord | null; // from types/geo-types
  totalDistanceMeters: number;
  failedWriteCount?: number;
  rawGpsPath?: GpsCoord[]; // from types/geo-types
  fusedPath?: GpsCoord[]; // from types/geo-types
  referencePointsForMap?: RefPointMarkerInput[]; // from ./draw-ref-point-markers; carries timestamp for prior/current classification
  alignmentSnapshotPath?: GpsCoord[]; // Red dot positions from alignment snapshots
  zipSizeBytes?: number; // Issue #3 (2026-02-06): ZIP file size in bytes
  zipFileCount?: number; // Issue #3 (2026-02-06): Number of files in ZIP
  zipBlob?: Blob; // Issue #2 (2026-02-06): ZIP blob for sharing
  zipFilename?: string; // Issue #2 (2026-02-06): Suggested filename
}
```

### Functions

| Function                        | Description                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `initSessionSummary(callbacks)` | Initialize the panel and wire up button handlers. Must be called once at startup. Throws if required DOM elements are missing. |
| `showSessionSummary(data)`      | Display the summary panel with the provided data. Throws if `initSessionSummary` was not called.                               |
| `hideSessionSummary()`          | Hide the summary panel and destroy the Leaflet map instance if active (Bug 11 fix). Safe to call before init (no-op).          |
| `formatFileSize(bytes)`         | Re-exported from `utils/format-file-size`. Converts byte count to human-readable string.                                       |

## Invariants & Assumptions

1. **TERMINAL STATE**: Once the summary is shown, the recording session is ended. No state exists to restart from.
2. **DOM DEPENDENCY**: Requires specific HTML elements in `index.html` (see below).
3. **Fail-fast**: Throws immediately if required DOM elements are missing during init.
4. **Data immutability**: The `SessionSummaryData` passed to `showSessionSummary` is not stored; UI is populated immediately.
5. **Map cleanup on hide**: `hideSessionSummary()` destroys `currentMapInstance` immediately to free Leaflet resources and avoid stale map state after soft reset (Bug 11 fix).

### Required HTML Elements

```html
<div id="session-summary-panel" class="hidden">
  <div id="summary-duration"></div>
  <div id="summary-gps-count"></div>
  <div id="summary-ref-points"></div>
  <div id="summary-images"></div>
  <div id="summary-depth-samples"></div>
  <div id="summary-failed-writes"></div>
  <div id="summary-errors"></div>
  <div id="summary-first-gps"></div>
  <div id="summary-last-gps"></div>
  <div id="summary-distance"></div>
  <div id="summary-zip-size"></div>
  <!-- optional, Issue #3 -->
  <div id="summary-zip-files"></div>
  <!-- optional, Issue #3 -->
  <button id="btn-share-session"></button>
  <!-- optional, Issue #2 -->
  <button id="btn-new-recording"></button>
  <button id="btn-view-logs"></button>
  <!-- optional -->
  <div id="summary-map-container"></div>
  <!-- optional -->
</div>
```

## Examples

### Initialization (in main.ts)

```typescript
import { initSessionSummary, showSessionSummary } from './ui/session-summary';

initSessionSummary({
  onNewRecording: () => window.location.reload(),
  onViewLogs: () => console.log('View logs clicked'),
});
```

### Showing Summary After Recording Stops

```typescript
const summaryData: SessionSummaryData = {
  duration: { startTime: sessionStartTime, endTime: Date.now() },
  gpsEventCount: gpsPositions.length,
  refPointCount: refPoints.length,
  imageCount: getImageCaptureFrameCount(),
  depthSampleCount: getDepthSampleCount(),
  errors: ['GPS accuracy degraded at 00:30'],
  firstGps: { lat: 50.0, lng: 8.0 },
  lastGps: { lat: 50.001, lng: 8.001 },
  totalDistanceMeters: 150.5,
};

showSessionSummary(summaryData);
```

## Tests

Unit tests are in `session-summary.test.ts` and cover:

- **Initialization**: Fail-fast when DOM missing, button wiring
- **Display**: All data fields rendered correctly, duration formatting
- **Edge cases**: Empty GPS data, many errors, zero counts
- **Visibility**: Panel shown/hidden correctly
- **Failed writes**: Count display, warning highlighting (Issue #1 Part B)
- **ZIP stats**: Human-readable size, file count, placeholder for missing data (Issue #3)
- **Share session**: Button visibility, Web Share API with file, download fallback (Issue #2)
- **Map cleanup**: Map destroyed immediately on hide, not deferred (Bug 11 regression)
- **formatFileSize**: Re-exported utility sanity tests

Run tests:

```bash
npm run test:unit -- src/ui/session-summary.test.ts
```

## Related Files

- [index.html](../../index.html) - HTML markup for the panel
- [main.ts](../main.ts) - Initialization and `handleStopRecording` integration
- [README.md](../../README.md#session-summary-panel-summary-state) - Spec definition
- [2026-01-25-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-01-25-user-feedback.md) - Original user feedback
