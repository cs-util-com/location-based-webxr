# app-selectors.ts

## Purpose

App-level selectors over the library slice state. Establishes a consistent `select*` naming convention and provides the foundation for change-gated subscriptions via `subscribeToSelector`. The property-read selectors are plain functions (reference-stable because the state is immutable and the empty fallbacks are module-level constants); only the mapping selector `selectFrameTilesInWebXR` is wrapped in `createSelector`, because it allocates.

## Public API

| Symbol                    | Signature                                             | Returns                              |
| ------------------------- | ----------------------------------------------------- | ------------------------------------ |
| `selectAlignmentMatrix`   | `(state: CombinedRootState) => Matrix4 \| null`       | 4×4 alignment matrix, or null        |
| `selectGpsPositions`      | `(state: CombinedRootState) => readonly GpsPoint[]`   | Recorded GPS positions with metadata |
| `selectOdometryPositions` | `(state: CombinedRootState) => readonly Vector3[]`    | Odometry positions (AR-local space)  |
| `selectOdometryRotations` | `(state: CombinedRootState) => readonly Quaternion[]` | Odometry rotations (AR-local space)  |
| `selectZeroReference`     | `(state: CombinedRootState) => LatLong \| null`       | GPS origin for coordinate conversion |

`selectFrameTilesInWebXR` uses `state.gpsData` as the input dependency for `createSelector` memoization. If the `gpsData` reference hasn't changed between calls, the cached (mapped) array is returned without re-evaluating. The other selectors read one property and need no memo (removed 2026-09-04, simplify loop: a memo over a property read added a cache and a "memoized" label, not stability).

`selectFrameTilesInWebXR` is the exception: it keys on `state.gpsData?.odometryPath?.points` (not the whole `gpsData`). Because the library reducer uses Immer, unrelated updates (GPS observations, VIO offsets) yield a new `gpsData` reference while `odometryPath.points` keeps its reference via structural sharing. Keying on the points array preserves referential stability of the output across those dispatches, so `wireFrameTileSubscribers` only re-runs when frames actually change.

## Invariants & Assumptions

- Selectors return module-level empty array constants when `gpsData` (or `odometryPath.points`) is null, ensuring stable references for `subscribeToSelector` change detection.
- All selectors replicate the same property access as the library's getter functions (`getAlignmentMatrix`, `getGpsPositions`, etc.) but with `CombinedRootState` typing.
- The `gpsData` property path is part of the library's public `GpsSlamState` interface.

## Examples

```typescript
import { selectAlignmentMatrix, selectGpsPositions } from './app-selectors';

const matrix = selectAlignmentMatrix(store.getState()); // Matrix4 | null
const positions = selectGpsPositions(store.getState()); // readonly GpsPoint[]
```

## Tests

Covered by `app-selectors.test.ts` (13 test cases):

- Null state handling: returns null or empty array for each selector
- Populated state: returns correct values by reference
- Reference stability: same reference for same state, stable empty arrays across calls

## Related Files

- [subscribe-to-selector.ts](subscribe-to-selector.ts) — uses these selectors for change detection
- [store-subscribers.ts](store-subscribers.ts) — primary consumer
- [store.ts](store.ts) — `CombinedRootState` type definition
- [ref-points-slice.ts](ref-points-slice.ts) — `selectImportedKnownAnchors` follows the same pattern
