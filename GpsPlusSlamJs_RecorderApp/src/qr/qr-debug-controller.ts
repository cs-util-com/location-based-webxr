/**
 * QR debug controller — the WS-5 store-driven consumer (live + replay).
 *
 * Subscribes (via `update()` called on every store change) to the recorder's
 * `qrDetected` slice and renders, per marker, the shared debug axis+cube
 * ({@link createQrDebugView}) under `arWorldGroup` at the **derived** best-effort
 * pose+size. It owns the as-of depth resolver: every new
 * `recording.latestDepthSample` is fed to it, so the size join is reproducible —
 * the controller runs IDENTICALLY live and on replay because it only reads the
 * store. Replaying a raw recording with a different size/PnP algorithm therefore
 * shows the new placement (the maintainer's re-test goal, visualised).
 *
 * **Incremental derivation (perf-degradation fix, open topic D):** the placement
 * is derived via the stateful {@link createIncrementalQrPlacement} — it folds in
 * only NEW observations per marker (O(1) per detection) and memoizes when nothing
 * new arrived — NOT the stateless `selectDerivedQrPlacement`, which replays the
 * whole history on every store action (O(history)/action) and ramped the recorder
 * framerate down on device once the per-marker ring filled.
 *
 * Best-effort: a marker that cannot be sized yet (coarse occupancy depth) renders
 * NOTHING rather than throwing, and a transient miss does NOT clear an existing
 * view (persistence across throttled detections — the view keeps its last pose).
 * Views are torn down only when their marker leaves the store (`clearQrMarker` /
 * `clearAllQrMarkers`).
 *
 * Everything device/PnP-specific is injectable (resolver, solver, view factory,
 * placement selector) so the orchestration is unit-testable without WebXR, three
 * rendering, or PnP numerics (those are covered by the framework tests).
 *
 * @see qr-depth-resolver.ts — the as-of depth join this drives.
 * @see gps-plus-slam-app-framework/ar/qr/qr-debug-view — the rendered axis+cube.
 */

import type { Object3D } from 'three';
// Deep subpaths (NOT the `…/ar` or `…/state` barrels) — the barrels eagerly pull
// heavy transitive deps that break main.ts's partially-mocked wiring tests. Same
// rationale as the demo's qr-debug-view.
import {
  createQrDebugView,
  type QrDebugView,
} from 'gps-plus-slam-app-framework/ar/qr/qr-debug-view';
import { PlanarPnpSquare } from 'gps-plus-slam-app-framework/ar/qr/planar-pnp';
import {
  createIncrementalQrPlacement,
  type DeriveQrPoseDeps,
  type DerivedQrPlacement,
  type IncrementalQrPlacement,
  type RawQrObservation,
} from 'gps-plus-slam-app-framework/ar/qr/qr-derived-pose';
import type { SolvePnpSquare } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  selectQrRawObservations,
  type QrDetectedState,
} from 'gps-plus-slam-app-framework/state/qr-detected-slice';
import type { DepthSample } from 'gps-plus-slam-app-framework/types/ar-types';
import {
  createQrDepthResolver,
  type QrDepthResolver,
} from './qr-depth-resolver';

/** The minimal store shape the controller reads (a subset of CombinedRootState). */
export interface QrDebugControllerState {
  qrDetected: QrDetectedState;
  recording: { latestDepthSample: DepthSample | null };
}

export interface QrDebugControllerDeps {
  /** Read the current store state (the controller never subscribes itself). */
  getState: () => QrDebugControllerState;
  /** The `arWorldGroup` to parent debug objects under; `null` until AR starts. */
  getArWorldGroup: () => Object3D | null;
  /**
   * Called once per NEW detection with the placement derived for it.
   *
   * Rendering is not the only consumer of a derived placement: the session
   * mint folds the same stream into sightings. This hook exists so there is
   * ONE deriver — a second consumer with its own would double both the PnP
   * work and the accumulated size state, and the two could disagree.
   *
   * "Once per new detection", not once per frame: `update()` runs on every
   * animation frame, so the marker's newest timestamp is what gates the
   * call. It fires whether or not AR is running, because a sighting is
   * evidence regardless of whether anything is being drawn.
   */
  onPlacement?: (
    text: string,
    placement: DerivedQrPlacement,
    timestampMs: number
  ) => void;
  /** As-of depth resolver (default {@link createQrDepthResolver}). */
  resolver?: QrDepthResolver;
  /** PnP backend (default {@link PlanarPnpSquare}). */
  solver?: SolvePnpSquare;
  /** Debug-view factory (default {@link createQrDebugView}) — overridable in tests. */
  createView?: (parent: Object3D) => QrDebugView;
  /**
   * Incremental placement deriver (default {@link createIncrementalQrPlacement})
   * — overridable in tests. Stateful: folds new observations per marker (O(1) per
   * detection) and memoizes when nothing new arrived.
   */
  deriver?: IncrementalQrPlacement;
  /** Map a marker's stored entries to raw observations (default {@link selectQrRawObservations}). */
  selectObservations?: (
    state: QrDebugControllerState,
    text: string
  ) => RawQrObservation[];
  /** Size-measurer tuning forwarded to the derive layer. */
  sizeOptions?: DeriveQrPoseDeps['sizeOptions'];
  /** Reprojection-error gate forwarded to the derive layer. */
  maxReprojectionErrorPx?: number;
}

export interface QrDebugController {
  /** Reconcile the debug objects with the current store state. Call per store change. */
  update(): void;
  /** Tear down all views + the depth resolver (e.g. on session end). */
  dispose(): void;
}

export function createQrDebugController(
  deps: QrDebugControllerDeps
): QrDebugController {
  const resolver = deps.resolver ?? createQrDepthResolver();
  const solver = deps.solver ?? new PlanarPnpSquare();
  const createView = deps.createView ?? createQrDebugView;
  const selectObservations = deps.selectObservations ?? selectQrRawObservations;

  const deriveDeps: DeriveQrPoseDeps = {
    resolveDepthAt: (t) => resolver.resolveDepthAt(t),
    solver,
    ...(deps.sizeOptions ? { sizeOptions: deps.sizeOptions } : {}),
    ...(deps.maxReprojectionErrorPx !== undefined
      ? { maxReprojectionErrorPx: deps.maxReprojectionErrorPx }
      : {}),
  };
  // ONE persistent deriver across update() calls (the incremental state lives here).
  const deriver = deps.deriver ?? createIncrementalQrPlacement(deriveDeps);

  const views = new Map<string, QrDebugView>();
  let lastSample: DepthSample | null = null;
  /** Newest reported detection timestamp per marker — the once-per-detection gate. */
  const lastReported = new Map<string, number>();

  // F-8 (2026-07-10 quality review): `selectQrRawObservations` rebuilds an
  // O(history) array per marker per rAF tick. The qrDetected slice is
  // immutable-append, so a marker's `detections` reference is a sound cache
  // key — reuse the mapped observations while it is unchanged.
  const observationCache = new Map<
    string,
    { detections: unknown; observations: ReturnType<typeof selectObservations> }
  >();
  function selectObservationsCached(
    state: ReturnType<QrDebugControllerDeps['getState']>,
    text: string
  ): ReturnType<typeof selectObservations> {
    const detections = state.qrDetected.markers[text]?.detections;
    const cached = observationCache.get(text);
    if (cached && cached.detections === detections) {
      return cached.observations;
    }
    const observations = selectObservations(state, text);
    observationCache.set(text, { detections, observations });
    return observations;
  }

  function update(): void {
    const state = deps.getState();

    // 1) Feed the as-of depth history. Both live capture and replay update
    //    `latestDepthSample`; append only on identity change (cheap on every tick).
    const sample = state.recording.latestDepthSample;
    if (sample && sample !== lastSample) {
      lastSample = sample;
      resolver.append(sample);
    }

    // 2) Drop views whose marker left the store (clearQrMarker / clearAllQrMarkers)
    //    and clear that marker's accumulated derive state so a re-appearance starts
    //    fresh (and the measurer doesn't retain stale size for a reused payload).
    const markers = state.qrDetected.markers;
    // Map iterators tolerate deletion during iteration, so no spread copy is
    // needed per tick (F-8 nit).
    for (const text of views.keys()) {
      if (!(text in markers)) {
        views.get(text)!.dispose();
        views.delete(text);
        deriver.reset(text);
        observationCache.delete(text);
      }
    }

    // 3) Derive each marker's best-effort placement, report new ones, and
    //    render them. The deriver folds only NEW observations (O(1)/detection)
    //    and memoizes when nothing changed.
    const parent = deps.getArWorldGroup();
    for (const text of Object.keys(markers)) {
      const observations = selectObservationsCached(state, text);
      const placement = deriver.update(text, observations);
      // Not sizeable yet (or PnP-rejected) → render nothing; a prior view keeps
      // its last pose (persistence) rather than being cleared on a transient miss.
      if (!placement) continue;

      // One report per NEW detection, not per frame. Reported BEFORE the
      // arWorldGroup check: a sighting is evidence whether or not anything
      // is being drawn, and the mint must not depend on AR being up.
      const newest = observations.at(-1)?.timestamp;
      if (newest !== undefined && newest !== lastReported.get(text)) {
        lastReported.set(text, newest);
        deps.onPlacement?.(text, placement, newest);
      }

      if (!parent) continue;
      let view = views.get(text);
      if (!view) {
        view = createView(parent);
        views.set(text, view);
      }
      view.update(placement.pose, placement.sizeM);
    }
  }

  return {
    update,
    dispose(): void {
      for (const view of views.values()) view.dispose();
      views.clear();
      observationCache.clear();
      lastReported.clear();
      resolver.reset();
      lastSample = null;
    },
  };
}
