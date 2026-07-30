/**
 * Store Subscribers Module
 *
 * Extracted from main.ts (Iteration 4, Risk R2 fix).
 * Provides a reusable function to wire store state-change listeners to
 * visualization dependencies (alignment matrix, GPS event markers, map overlay).
 *
 * Both the live recording path and the replay path call wireStoreSubscribers()
 * with the same interface, ensuring identical behavior.
 *
 * Uses subscribeToSelector for selective change detection — callbacks only
 * fire when the specific state slice they care about actually changes.
 * This replaces the manual lastX tracking variables from the original design.
 *
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-19-replay-mode.md Issue 2, Risk R2
 * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-07-architecture-observations-consolidated.md §1
 */

import type { LatLong, Matrix4, Vector3, Quaternion } from 'gps-plus-slam-js';
import { calcGpsCoords } from 'gps-plus-slam-js';
import { vec3, mat4 } from 'gl-matrix';
import { buildMapData, type MapData } from '../visualization/map-data';
import type { GpsCoord } from '../types/geo-types';
import {
  subscribeToSelector,
  type SubscribableStore,
} from './subscribe-to-selector';
import {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectOdometryRotations,
  selectZeroReference,
} from './app-selectors';
import { createLogger } from '../utils/logger';

const log = createLogger('StoreSubscribers');

// Re-export SubscribableStore for backwards compatibility (it was
// originally defined here and is part of the public API via index.ts).
export type { SubscribableStore } from './subscribe-to-selector';

/**
 * Dependencies injected into wireStoreSubscribers.
 * Uses minimal interfaces — callers pass the real singletons or test mocks.
 */
export interface StoreSubscriberDeps {
  /** Apply alignment matrix to the AR world group (from webxr-session.ts). */
  applyAlignmentMatrix: (matrix: Matrix4) => void;

  /** GPS event visualizer — adds raw + fused marker spheres. */
  gpsEventVisualizer: {
    getZeroRef: () => LatLong | null;
    setZeroRef: (zero: LatLong) => void;
    addGpsEvent: (
      gpsCoords: Vector3,
      odomPosition: Vector3,
      accuracy?: { horizontal?: number; vertical?: number }
    ) => void;
    addAlignmentSnapshot: (nuePosition: Vector3) => void;
  };

  /**
   * Map overlay — renders the shared trajectory snapshot. Nullable (not
   * present in all modes).
   *
   * `setGpsPosition` centers the map on the same coordinate the blue dot
   * shows — the rebuilt `MapData.userPosition` (fused tip when aligned, raw
   * fix before the first solve; raw also for a render-less overlay, which
   * has no rebuilt snapshot to follow); `render` draws the
   * full {@link MapData} snapshot (raw GPS + accuracy circles, fused path,
   * alignment snapshots, user dot) via the shared `drawMapData` routine — the
   * SAME one the 2D session-summary map uses, so the live and summary maps
   * stay identical (unified-trajectory-map Phase 3). The previous incremental
   * `addRawGpsPoint` / `addFusedPoint` / `addAlignmentSnapshot` API is gone:
   * the fused path now recomputes from the latest matrix on every rebuild
   * (D2), so the live polyline "snaps" as alignment improves.
   */
  mapOverlay?: {
    setGpsPosition: (lat: number, lon: number) => void;
    render?: (data: MapData) => void;
  } | null;

  /**
   * Optional callback invoked with the GPS world-space coordinates of each
   * newly visualized GPS event. Used in replay mode to auto-follow the orbit
   * camera target to the latest position (Risk R9 fix).
   *
   * Not provided in live recording mode (camera is XR-controlled).
   */
  onNewGpsPosition?: (coords: Vector3) => void;

  /**
   * Optional callback invoked with the odom position and rotation of each
   * newly dispatched GPS event. Used in replay mode to update the arpose
   * Object3D so the camera follows the recorded AR trajectory.
   *
   * Not provided in live recording mode (arpose stays at identity).
   */
  onNewOdomPose?: (odomPosition: Vector3, odomRotation: Quaternion) => void;

  /**
   * Optional callback invoked with the transformed NUE position each time
   * an alignment snapshot is captured. Used in replay mode to update the
   * orbit camera target to the snapshot position (Issue #3).
   */
  onAlignmentSnapshot?: (nuePosition: Vector3) => void;

  /**
   * Optional callback invoked with raw lat/lng of each newly processed GPS
   * event. Used in live recording to drive ref-point proximity detection
   * for dynamic button label updates.
   */
  onNewGpsLatLng?: (lat: number, lng: number) => void;

  /**
   * When `true`, the recorded GPS 1σ accuracies (`latLongAccuracy`,
   * `altitudeAccuracy`) on each `GpsPoint` are forwarded to `addGpsEvent`
   * so the raw-GPS marker renders as a non-uniform-scaled ellipsoid (see
   * `gps-event-markers.ts` §3). When `false` (the default) the accuracies
   * are dropped and the legacy fixed 8 cm sphere is used.
   *
   * Live recording leaves this `false` (large ellipsoids would distract the
   * operator). Replay mode sets it to `true` so the diagnostic is visible.
   */
  showAccuracySpheres?: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wire store state-change subscriptions to visualization dependencies.
 *
 * Uses subscribeToSelector to decompose the monolithic subscriber into
 * focused, change-gated callbacks:
 * 1. Alignment matrix changes → apply matrix + capture snapshots
 * 2. GPS position changes → incremental event visualization + map overlay
 * 3. Reference point changes → forward to map overlay
 *
 * Each subscription uses reference equality to detect changes — callbacks
 * only fire when the selector output actually differs between dispatches.
 *
 * Each call creates **fresh subscriptions** — no manual reset needed between
 * sessions. Call the returned unsubscribe function to tear down all.
 *
 * @param store — any object satisfying SubscribableStore (RecorderStore, replay store, mock)
 * @param deps  — visualization dependencies (real singletons or test mocks)
 * @returns An unsubscribe function that removes all listeners from the store.
 */
export function wireStoreSubscribers(
  store: SubscribableStore,
  deps: StoreSubscriberDeps
): () => void {
  // Pre-allocate gl-matrix scratch vectors for alignment snapshot computation.
  const _odomVec = vec3.create();
  const _alignedVec = vec3.create();

  const unsubs: Array<() => void> = [];

  // Accumulated alignment-snapshot GPS positions (one per alignment-matrix
  // change). Fed into the shared MapData snapshot so the live overlay draws
  // the red snapshot polyline the same way the summary map does.
  const alignmentSnapshotGps: GpsCoord[] = [];

  /**
   * Rebuild the full map snapshot from the current store state and hand it to
   * the overlay's `render`. Called whenever the alignment matrix or the GPS
   * positions change — the change-gated subscriptions below provide the
   * throttling, so no extra debouncing is needed. The fused path is always
   * recomputed from the latest matrix inside `buildMapData` (D2).
   *
   * Returns the rendered `MapData` so the GPS subscription can center the map
   * on the SAME coordinate the dot shows (fused when available — 2026-07-06
   * fused-dot feedback, Slice B), or `null` when there is no overlay or it
   * has no `render` (the minimal `setGpsPosition`-only dep shape).
   */
  // E-6 (2026-07-10 quality review): one `recordGpsEvent` dispatch changes
  // BOTH the alignment matrix and the GPS positions, so the two change-gated
  // subscriptions below each called rebuildMap — 2× O(full history) per GPS
  // event. Memoize on the input references (immutable store slices + the
  // snapshot count this module owns); the second same-dispatch call becomes a
  // cache hit that still returns the MapData the centering logic needs.
  let lastGpsPositionsRef: unknown = null;
  let lastOdomPositionsRef: unknown = null;
  let lastMatrixRef: unknown = null;
  let lastZeroRef: unknown = null;
  let lastSnapshotCount = -1;
  let lastMapData: MapData | null = null;

  function rebuildMap(): MapData | null {
    if (!deps.mapOverlay?.render) return null;
    const state = store.getState();
    const gpsPositions = selectGpsPositions(state);
    const odometryPositions = selectOdometryPositions(state);
    const alignmentMatrix = selectAlignmentMatrix(state);
    const zeroRef = selectZeroReference(state);
    if (
      gpsPositions === lastGpsPositionsRef &&
      odometryPositions === lastOdomPositionsRef &&
      alignmentMatrix === lastMatrixRef &&
      zeroRef === lastZeroRef &&
      alignmentSnapshotGps.length === lastSnapshotCount
    ) {
      return lastMapData;
    }
    const rawGpsPath = gpsPositions.map((p) => ({
      lat: p.latitude,
      lng: p.longitude,
      accuracy: p.latLongAccuracy,
    }));
    const data = buildMapData({
      rawGpsPath,
      odometryPositions,
      odometryRotations: selectOdometryRotations(state),
      alignmentMatrix,
      zeroRef,
      alignmentSnapshots: alignmentSnapshotGps,
    });
    lastGpsPositionsRef = gpsPositions;
    lastOdomPositionsRef = odometryPositions;
    lastMatrixRef = alignmentMatrix;
    lastZeroRef = zeroRef;
    lastSnapshotCount = alignmentSnapshotGps.length;
    lastMapData = data;
    // `render` is a consumer-supplied boundary (e.g. a Leaflet redraw that
    // can fail transiently on a disposed container). A throw here must not
    // escape the store listener — it would skip the follow-up centering AND
    // break the whole dispatch chain for that action, recurring on every GPS
    // tick — so contain it and still hand the snapshot to the caller.
    try {
      deps.mapOverlay.render(data);
    } catch (err) {
      log.warn('Map overlay render failed; continuing with centering:', err);
    }
    return data;
  }

  // 1. Alignment matrix → apply to AR world group + capture snapshots
  unsubs.push(
    subscribeToSelector(store, selectAlignmentMatrix, (matrix) => {
      if (!matrix) return;
      deps.applyAlignmentMatrix(matrix);

      // Capture alignment snapshot (Issue #1)
      const state = store.getState();
      const odomPositions = selectOdometryPositions(state);
      if (odomPositions.length > 0) {
        const latestOdom = odomPositions[odomPositions.length - 1]!;
        const glMat = mat4.fromValues(...matrix);
        vec3.set(_odomVec, latestOdom[0], latestOdom[1], latestOdom[2]);
        vec3.transformMat4(_alignedVec, _odomVec, glMat);
        const snapshotPos: Vector3 = [
          _alignedVec[0],
          _alignedVec[1],
          _alignedVec[2],
        ];
        deps.gpsEventVisualizer.addAlignmentSnapshot(snapshotPos);
        deps.onAlignmentSnapshot?.(snapshotPos);

        // Accumulate alignment snapshot as a GPS coord for the map overlay.
        const zeroRef = selectZeroReference(state);
        if (zeroRef) {
          const gps = calcGpsCoords(zeroRef, _alignedVec);
          alignmentSnapshotGps.push({ lat: gps.lat, lng: gps.lon });
        }
      }

      // Matrix changed → fused path snaps; redraw the whole map snapshot.
      rebuildMap();
    })
  );

  // 2. GPS positions → incremental event visualization + map overlay position
  unsubs.push(
    subscribeToSelector(
      store,
      selectGpsPositions,
      (gpsPositions, prevPositions) => {
        const prevCount = prevPositions?.length ?? 0;
        const state = store.getState();

        // Set the visualizer's zero reference once, as a readiness gate.
        //
        // This is intentionally one-shot (guarded by `!getZeroRef()`) and is
        // NOT a divergence trap despite mirroring the store value: the
        // GpsEventVisualizer never uses this field for coordinate math — each
        // GpsPoint's `coordinates` are baked to metres-from-origin by the
        // library reducer at record time (`calcRelativeCoordsInMeters`), so a
        // stale/changed store zero cannot offset markers here. (The
        // load-bearing zero reference is RefPointVisualizer's, kept in sync via
        // the recorder's wireRefPointSubscribers.) See state-outside-store
        // audit F2 — do not "fix" this into an unconditional re-push; that adds
        // redundant calls for zero behavioural gain.
        const zeroRef = selectZeroReference(state);
        if (zeroRef && !deps.gpsEventVisualizer.getZeroRef()) {
          deps.gpsEventVisualizer.setZeroRef(zeroRef);
        }

        const odomPositions = selectOdometryPositions(state);
        const odomRotations = selectOdometryRotations(state);

        // Add markers for any new GPS events
        for (let i = prevCount; i < gpsPositions.length; i++) {
          const gpsPoint = gpsPositions[i];
          const odomPos = odomPositions[i];
          if (gpsPoint && odomPos) {
            // Forward 1σ accuracies only when the caller opts in (replay
            // mode). Live recording keeps the legacy fixed sphere by passing
            // `undefined` here.
            const accuracy = deps.showAccuracySpheres
              ? {
                  horizontal: gpsPoint.latLongAccuracy,
                  vertical: gpsPoint.altitudeAccuracy,
                }
              : undefined;
            deps.gpsEventVisualizer.addGpsEvent(
              gpsPoint.coordinates,
              odomPos,
              accuracy
            );
            deps.onNewGpsPosition?.(gpsPoint.coordinates);
            deps.onNewGpsLatLng?.(gpsPoint.latitude, gpsPoint.longitude);

            // Update arpose with recorded odom pose (replay mode)
            const odomRot = odomRotations[i];
            if (odomRot) {
              deps.onNewOdomPose?.(odomPos, odomRot);
            }
          }
        }

        // Redraw the full trajectory snapshot first, then center the overlay
        // on the SAME coordinate the blue dot shows — the rebuilt MapData's
        // userPosition (fused tip when aligned, raw fix before the first
        // solve). Centering on the raw fix while the dot is fused would walk
        // the dot off-center exactly in the indoor scenario of the 2026-07-06
        // fused-dot feedback (Slice B). For a render-less overlay (minimal
        // `setGpsPosition`-only shape) there is no MapData — keep the raw fix
        // rather than paying a fused-path recompute for a map that draws
        // nothing (decision 6). Alignment-change redraws (subscription 1)
        // intentionally do NOT re-center: centering stays a GPS-event-rate
        // concern.
        const mapData = rebuildMap();
        if (deps.mapOverlay && gpsPositions.length > 0) {
          if (mapData?.userPosition) {
            deps.mapOverlay.setGpsPosition(
              mapData.userPosition.lat,
              mapData.userPosition.lng
            );
          } else {
            const lastGpsPoint = gpsPositions[gpsPositions.length - 1]!;
            deps.mapOverlay.setGpsPosition(
              lastGpsPoint.latitude,
              lastGpsPoint.longitude
            );
          }
        }
      }
    )
  );

  // 3. Reference points — the recorder app owns the ref-points slice and
  // wires its own visualizer + map-overlay subscription on top of this
  // function (see RecorderApp's wireRefPointSubscribers). Framework remains
  // agnostic of ref points after Iter 4 of the boundary migration.

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
