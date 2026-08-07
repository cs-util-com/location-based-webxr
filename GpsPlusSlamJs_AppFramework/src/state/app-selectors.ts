/**
 * App-level memoized selectors for CombinedRootState.
 *
 * Wraps library getter functions with createSelector (RTK/reselect) for
 * standard memoization. The library getters already return stable references
 * via immutable state, but createSelector adds:
 * - Explicit memoization contract (input comparison → cached output)
 * - Consistent select* naming convention matching selectCachedKnownRefPoints
 * - Composition-ready building blocks for derived selectors
 *
 * Used by subscribeToSelector in store-subscribers.ts for change detection.
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-07-architecture-observations-consolidated.md §1
 */

import { createSelector } from '@reduxjs/toolkit';
import type { CombinedRootState } from './combined-root-state';
import type {
  ArImageCapture,
  GpsPoint,
  LatLong,
  Matrix4,
  Quaternion,
  Vector3,
} from 'gps-plus-slam-js';
import { nueToWebXR, nueQuaternionToWebXR } from 'gps-plus-slam-js';

// ---------------------------------------------------------------------------
// Stable fallback constants — must be module-level to maintain referential
// stability across calls (same contract as the library's selectors.ts).
// ---------------------------------------------------------------------------

const EMPTY_GPS_POSITIONS: readonly GpsPoint[] = [];
const EMPTY_ODOM_POSITIONS: readonly Vector3[] = [];
const EMPTY_ODOM_ROTATIONS: readonly Quaternion[] = [];
const EMPTY_FRAME_TILES: readonly ArImageCapture[] = [];

// ---------------------------------------------------------------------------
// Input selector — shared across all selectors for gpsData-derived values.
// createSelector compares this by reference; if gpsData hasn't changed,
// the output selector is skipped and the cached result is returned.
// ---------------------------------------------------------------------------

/**
 * Minimal root these selectors read (quality-review G-2). Typed as a Pick of
 * the `gpsData` slice ONLY, so ANY consumer store that mounts the library's
 * gpsData reducer is structurally assignable — the former full
 * `CombinedRootState` parameter forced `as unknown as` casts (MinimalExample),
 * a `sel()` helper (AnchorStarter), or a re-declared root type (RecorderApp)
 * in every consumer, and a renamed slice would have compiled and failed at
 * runtime.
 */
type RootWithGpsData = Pick<CombinedRootState, 'gpsData'>;

const selectGpsData = (state: RootWithGpsData) => state.gpsData;

// ---------------------------------------------------------------------------
// Memoized selectors
// ---------------------------------------------------------------------------

/** Alignment matrix (4×4), or null if not yet computed. */
export const selectAlignmentMatrix = createSelector(
  [selectGpsData],
  (gpsData): Matrix4 | null => gpsData?.gpsEvents?.alignmentMatrix ?? null
);

/** Recorded GPS positions with metadata. */
export const selectGpsPositions = createSelector(
  [selectGpsData],
  (gpsData): readonly GpsPoint[] =>
    gpsData?.gpsEvents?.gpsPositions ?? EMPTY_GPS_POSITIONS
);

/** Recorded odometry positions (AR-local space). */
export const selectOdometryPositions = createSelector(
  [selectGpsData],
  (gpsData): readonly Vector3[] =>
    gpsData?.gpsEvents?.odometryPositions ?? EMPTY_ODOM_POSITIONS
);

/** Recorded odometry rotations (AR-local space). */
export const selectOdometryRotations = createSelector(
  [selectGpsData],
  (gpsData): readonly Quaternion[] =>
    gpsData?.gpsEvents?.odometryRotations ?? EMPTY_ODOM_ROTATIONS
);

/** GPS zero reference (origin for coordinate conversion), or null. */
export const selectZeroReference = createSelector(
  [selectGpsData],
  (gpsData): LatLong | null => gpsData?.zero ?? null
);

/** User-defined reference points for ground truth validation. */
// `selectReferencePoints` removed in 5.7a-3 (Option C); see
// `2026-05-27-collapse-refpoint-and-frame-slices-plan.md`. The recorder now
// owns the flat `refPoints` slice as the single source of truth.

/**
 * Captured AR image frames in WebXR coordinate space.
 *
 * Reads `state.gpsData.odometryPath.points` (which the library reducer
 * stores in NUE convention — see `gpsDataSlice.ts` `add2dImage`) and
 * converts each entry back to WebXR so the live AR scene visualizer can
 * apply the pose directly. This is the source of truth for the
 * frame-tile visualizer; the legacy `framesInScene` slice is a dead
 * mirror scheduled for removal (Step 5 of the 2026-05-27
 * slice-collapse plan).
 *
 * Memoized via createSelector keyed on `odometryPath.points` (NOT the whole
 * `gpsData`). The library reducer uses Immer, so unrelated updates (GPS
 * observations, VIO offsets) produce a new `gpsData` reference while
 * `odometryPath.points` keeps its reference via structural sharing. Keying on
 * the points array therefore preserves referential stability of the output
 * across those dispatches — subscribers like `wireFrameTileSubscribers` only
 * re-run when frames actually change.
 */
const selectOdometryPathPoints = (state: RootWithGpsData) =>
  state.gpsData?.odometryPath?.points;

/**
 * The `ArImageCapture` fields the projection below consciously handles:
 * `position`/`rotation` are coordinate-converted (NUE → WebXR), the rest pass
 * through unchanged. Kept as an explicit union so the guard underneath can
 * compare it against the live `keyof ArImageCapture`.
 */
type ProjectedFrameTileKey =
  | 'imageFile'
  | 'position'
  | 'rotation'
  | 'screenRotation'
  | 'capturedAt'
  | 'width'
  | 'height';

/**
 * Compile-time guard (field-drop audit F4): if `ArImageCapture` (a library
 * type) gains a field, `keyof ArImageCapture` stops being assignable to
 * `ProjectedFrameTileKey` and this line fails to compile — forcing a conscious
 * decision in `selectFrameTilesInWebXR` (convert it, or extend the union to
 * pass it through) instead of silently dropping a new per-frame field from the
 * frame-tile visualizer. This is the single gateway between persisted frame
 * records and the AR-space visualizers.
 */
type AssertFrameTileProjectionExhaustive =
  keyof ArImageCapture extends ProjectedFrameTileKey ? true : never;
const _frameTileProjectionIsExhaustive: AssertFrameTileProjectionExhaustive = true;

export const selectFrameTilesInWebXR = createSelector(
  [selectOdometryPathPoints],
  (points): readonly ArImageCapture[] => {
    if (!points || points.length === 0) return EMPTY_FRAME_TILES;
    return points.map(
      (p): ArImageCapture => ({
        imageFile: p.imageFile,
        position: nueToWebXR(p.position),
        rotation: nueQuaternionToWebXR(p.rotation),
        screenRotation: p.screenRotation,
        capturedAt: p.capturedAt,
        // Pose-invariant pixel dimensions pass straight through (no coordinate
        // conversion) so the frame-tile visualizer can size tiles to the true
        // image aspect ratio (D1 of the 2026-06-13 frame-tile feedback).
        width: p.width,
        height: p.height,
      })
    );
  }
);
