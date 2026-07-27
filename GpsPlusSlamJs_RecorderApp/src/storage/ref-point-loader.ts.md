# ref-point-loader.ts

## Purpose

Manages loading, saving, and transforming reference points from the scenario's `refPoints/` directory. Each reference point is stored as a separate JSON file containing all observations across sessions.

## Public API

### Types

| Type                  | Description                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `RefPointObservation` | Single observation of a reference point in one session (includes optional `fusedGpsPoint` from alignment) |
| `RefPointDefinition`  | Complete definition with ID, name, and all observations                                                   |
| `RefPointMark`        | Flattened observation for visualization (canonical type)                                                  |

### Functions

| Export                      | Signature                                                   | Description                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadAllRefPoints`          | `(scenarioHandle) => Promise<RefPointDefinition[]>`         | Load all ref point JSON files from refPoints/                                                                                                                                    |
| `loadRefPoint`              | `(scenarioHandle, pointId) => Promise<RefPointDefinition?>` | Load specific ref point by ID                                                                                                                                                    |
| `saveRefPointObservation`   | `(handle, id, name, obs) => Promise<void>`                  | Save/append observation to ref point file                                                                                                                                        |
| `listRefPointIds`           | `(scenarioHandle) => Promise<string[]>`                     | List all ref point IDs for autocomplete                                                                                                                                          |
| `flattenRefPointsToMarks`   | `(defs) => RefPointMark[]`                                  | Transform definitions to flat visualization list (prefers `fusedGpsPoint` over raw `gpsPoint`)                                                                                   |
| `averageGpsPerRefPoint`     | `(defs) => AveragedRefPoint[]`                              | Compute GPS centroid per ref point ID (prefers fusedGpsPoint over raw gpsPoint), over the observations passing the accuracy gate (D6(a) robust averaging)                        |
| `REF_POINT_ACCURACY_GATE_M` | `const 20`                                                  | Horizontal-accuracy gate (m) for the robust average — empirically chosen from recorded-session data (legitimate observations sit ≤ ~10 m; the gate only fires on degraded fixes) |
| `isRefPointDefinition`      | `(value: unknown) => value is RefPointDefinition`           | Deep type guard: validates base shape **and** every observation's `arPose`/`gpsPoint` nested fields. Reused by `recording-loader.ts` for sidecar validation                      |

## Invariants & Assumptions

- Reference points stored in `/<ScenarioName>/refPoints/<id>.json`
- Each JSON file contains all observations across all sessions
- `RefPointMark` is the canonical type for visualization (re-exported by `store.ts`)
- `flattenRefPointsToMarks` handles undefined altitude gracefully and **prefers `obs.fusedGpsPoint` over `obs.gpsPoint`** when present, with **per-field fallback** (Option B): when the fused value lacks `altitude` it falls back to the raw `obs.gpsPoint.altitude` while keeping fused lat/lon. This rescues legacy recordings where `fusedGpsPoint.altitude` was persisted as `undefined` due to the calcGpsCoords altitude-discard bug fixed 2026-04-30. See `2026-04-24-refpoint-positioning-investigation.md` §7 and `2026-04-29-ref-points-user-feedback.md` Finding 1.
- File operations are async and may throw on permission errors
- **Safe write pattern**: `saveRefPointObservation` writes through the framework helper `writeFileOrAbort` (`gps-plus-slam-app-framework/storage/write-file-or-abort`), which aborts the writable on failure to release file locks — preventing `InvalidStateError` on subsequent writes when storage is full. This module owns only the filename and the serialization.
- **Deep validation**: `isRefPointDefinition` type guard validates nested observation structure (arPose.position, arPose.rotation, gpsPoint.latitude, gpsPoint.longitude) to prevent runtime crashes from corrupted files
- **Accuracy gate (D6(a) robust averaging, 2026-07-06)**: `averageGpsPerRefPoint` excludes observations whose raw `latLongAccuracy` exceeds `REF_POINT_ACCURACY_GATE_M` (20 m). Observations without a finite accuracy are kept (the gate only acts on provably bad fixes). Starvation guard: when fewer than `min(3, total)` observations survive, the original set is kept — 1–2-observation definitions always pass through unchanged. On the historical corpus the gate is a no-op (max legitimate accuracy 10.2 m); it exists as insurance against indoor-poisoned captures (51–74 m regime).

## Data Flow

```
RefPointDefinition[]  ──flattenRefPointsToMarks()──▶  RefPointMark[]
       ▲                                                    │
       │                                                    ▼
  loadAllRefPoints()                              refPointVisualizer
       ▲
       │
  refPoints/*.json
```

## Examples

```typescript
import {
  loadAllRefPoints,
  flattenRefPointsToMarks,
  saveRefPointObservation,
} from './storage/ref-point-loader';

// Load and flatten for visualization
const defs = await loadAllRefPoints(scenarioHandle);
const marks = flattenRefPointsToMarks(defs);
visualizer.displayPriorRefPoints(marks);

// Save new observation
await saveRefPointObservation(scenarioHandle, 'pointA', 'Point A', {
  sessionId: 'recording-2025-01-08',
  timestamp: Date.now(),
  arPose: { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
  gpsPoint: lastGpsPoint,
});
```

## Tests

- `ref-point-loader.test.ts` - 35 unit tests
  - Load/save operations with mock FileSystem handles
  - Type guard validation for malformed JSON (top-level and nested observations)
  - `flattenRefPointsToMarks` helper with edge cases
  - `averageGpsPerRefPoint` centroid computation (single/multiple observations, fusedGpsPoint preference, altitude averaging, empty array)
  - Accuracy gate (D6(a)): poisoned-observation exclusion, undefined-accuracy kept, inclusive boundary, starvation guard, single-observation pass-through, gate-constant sync with the corpus check
  - Writable stream safety: verifies `abort()` is called when `write()` throws
- Coverage: ~97%
