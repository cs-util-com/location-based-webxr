# `core/` — Curated re-export of `gps-plus-slam-js`

**Purpose:** Single curated surface through which apps depending on
`gps-plus-slam-app-framework` consume symbols from the closed-source core
library `gps-plus-slam-js`. Apps `import { ... } from 'gps-plus-slam-app-framework/core'`
instead of importing from `gps-plus-slam-js` directly.

## Public API

Re-exports from `gps-plus-slam-js`:

| Symbol                                           | Kind     | Used by (app code)                                                                 |
| ------------------------------------------------ | -------- | ---------------------------------------------------------------------------------- |
| `webxrToNUE`                                     | function | RecorderApp `ref-points/ref-point-handlers.ts`                                     |
| `calcGpsCoords`                                  | function | RecorderApp `recording/recording-session-handlers.ts`                              |
| `calcRelativeCoordsInMeters`                     | function | Apps placing objects under the scene root (option 1 of the scene-graph convention) |
| `isIdentityMatrix4`                              | function | Framework + RecorderApp tests                                                      |
| `magneticHeadingFromEnuQuat`                     | function | RecorderApp live AbsCompass HUD read-out                                           |
| `arNorthBearingDeg`                              | function | AR-north bearing for compass comparison                                            |
| `bearingDeltaDeg`                                | function | Signed difference between two bearings                                             |
| `odometryTrackingRestarted`                      | action   | RecorderApp `main.ts`                                                              |
| `createLoopClosureHandler`                       | factory  | RecorderApp live loop-closure detection (operator-gated, default OFF)              |
| `createGpsSlamStore`                             | factory  | RecorderApp `recording-replay.integration.test.ts`                                 |
| `validateLicenseKey`                             | function | RecorderApp tests that exercise licensed math (e.g. visualization)                 |
| `Vector3`, `Quaternion`                          | type     | RecorderApp ref-point handlers + tests                                             |
| `Matrix4`                                        | type     | RecorderApp recording-session handlers                                             |
| `LatLong`                                        | type     | RecorderApp main.ts, recording-session handlers, action-schema test                |
| `LatLongAlt`                                     | type     | RecorderApp `ref-point-loader.ts` (altitude-bearing GPS shape)                     |
| `GpsPoint`                                       | type     | RecorderApp ref-point-handlers test                                                |
| `ArImageCapture`                                 | type     | RecorderApp frame-tile visualizer subscriber                                       |
| `LoopClosureHandler`, `LoopClosureHandlerConfig` | type     | Contract of `createLoopClosureHandler`                                             |
| `RootState`                                      | type     | Library root state — also re-exported as `LibraryRootState`                        |
| `LibraryRootState`                               | type     | Alias of library `RootState` for collision-free imports                            |

## Invariants & assumptions

- This module is **a re-export only** — it must not introduce any framework
  logic. The runtime implementation always lives in `gps-plus-slam-js`.
- The set of re-exports is intentionally **curated**, not `export *`. Adding a
  new symbol is a deliberate PR-visible change driven by an actual app need.
- The library exports a type named `RootState` that collides by name with the
  framework's own `RootState` (recorder store). Both are re-exported here to
  match the library's surface, and the alias `LibraryRootState` is provided so
  that consumers of the framework root barrel (which exports the framework's
  `RootState`) can import both unambiguously.

## Examples

```ts
// Production code (was: import { webxrToNUE } from 'gps-plus-slam-js')
import { webxrToNUE, type Vector3 } from 'gps-plus-slam-app-framework/core';

// Test code with disambiguation
import {
  createGpsSlamStore,
  isIdentityMatrix4,
  type LibraryRootState,
} from 'gps-plus-slam-app-framework/core';
```

## Tests

Re-exports are exercised transitively by the apps' own tests after Phase 2 of
the migration. A direct identity test lives in `index.test.ts` (colocated) to
guard against accidentally dropping a symbol from the curated list.

## Related docs

- [`2026-05-01-app-single-package-dep-analysis.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-app-single-package-dep-analysis.md)
  — design rationale for Option C and the curated barrel.
