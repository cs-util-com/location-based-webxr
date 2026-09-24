/**
 * `qrDetected` Redux slice — Note 3 of the QR-tracking follow-up plan
 * (docs `2026-06-15-1219-qr-tracking-generalization-overlay-and-north-followup.md`).
 *
 * A detection-agnostic, framework-level store of "what was detected, where, in
 * 3D" that overlay / trigger / anchor consumers subscribe to INDEPENDENTLY of
 * the GPS fusion. The QR-tracking controller dispatches into it on every lock
 * (alongside, or instead of, the synthetic GPS vote — the vote is optional, the
 * `qrDetected` emission is not). Both the QR-tracking demo and the Recorder
 * consume the SAME slice — it is not duplicated per app and does NOT live in the
 * closed-source fusion core (locked maintainer decision, 2026-06-15 interview).
 *
 * Shape (locked decision): a dictionary keyed by the decoded payload (text/URL),
 * value = a per-marker BOUNDED RING BUFFER of detections + a size-lifecycle
 * estimate. Identity is the payload itself (already unique, human-debuggable) —
 * two physically-distinct markers sharing a payload merge by design, and a
 * *moving* marker with one payload accumulates a motion path (also desired).
 * The ring buffer is bounded by {@link QrDetectedState.maxHistory} so a naive
 * consumer cannot leak; `pruneQrDetections` is the explicit custom-cleanup path.
 *
 * Detection-agnostic on purpose (Note 1): the same shape (world pose + label +
 * confidence + timestamp) generalizes to future object detection (YOLO etc.),
 * so the fields are deliberately not QR-specific beyond the payload key.
 *
 * This slice is OPT-IN: apps wire it via `createSlamAppStore({ extraReducers:
 * { qrDetected: qrDetectedReducer } })`. It is not a built-in of the store
 * factory, so framework consumers that never detect anything pay nothing.
 *
 * @see ../ar/qr/qr-tracking-controller.ts — the producer (dispatches `recordQrDetection`).
 * @see ../ar/qr/qr-pose.ts — `Pose` / `QrPoseSolution` (the per-detection geometry).
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Matrix4, Vector3 } from 'gps-plus-slam-js';
import type { Point2, Pose } from '../ar/qr/qr-pose.js';
import type { QrSizeEstimate } from '../ar/qr/qr-size-from-depth.js';
import {
  evaluateQrPoseStability,
  type QrPoseStability,
  type QrPoseStabilityOptions,
} from '../ar/qr/qr-pose-aggregation.js';
import {
  deriveSolvedQrPose,
  deriveQrPlacement,
  type DeriveQrPoseDeps,
  type DerivedQrPlacement,
  type RawQrObservation,
} from '../ar/qr/qr-derived-pose.js';
import { lowerMedian } from '../utils/median.js';
import { isSegmentingActionType } from './segmenting-actions.js';

// Re-exported so consumers of the slice keep importing the size lifecycle types
// from one place. They are DEFINED in `ar/qr/qr-size-from-depth.ts` (where size is
// measured) so this slice can use them without `ar` ever importing `state`.
export type {
  QrSizeStatus,
  QrSizeEstimate,
} from '../ar/qr/qr-size-from-depth.js';
// Same pattern for the pose-stability lifecycle (defined in `ar/qr/qr-pose-aggregation.ts`).
export type {
  QrPoseStabilityStatus,
  QrPoseStability,
  QrPoseStabilityOptions,
} from '../ar/qr/qr-pose-aggregation.js';

/**
 * Default ring-buffer cap per marker. Bounded so an overlay that never prunes
 * still cannot leak; large enough to support a robust median over a sliding
 * window and a short motion path. Override via {@link setQrMaxHistory}.
 */
export const DEFAULT_QR_MAX_HISTORY = 32;

/**
 * One detection observation. Detection-agnostic by design (Note 1): `text` is
 * the label/payload, `reprojectionErrorPx` the confidence proxy, the two poses
 * the 3D placement. `timestamp` is the producer's injected clock — see the field
 * note: the RAW recorder path stamps EPOCH ms so the derive-on-read depth as-of
 * join lines up with the depth stream (clock-domain coupling).
 */
export interface QrDetectionEntry {
  /** Decoded payload (text/URL) — also the marker key. */
  text: string;
  /**
   * Detection time in the producer's injected clock. For the RAW recorder path
   * this MUST be **EPOCH ms** (since QR perf plan M4: the frame's capture time,
   * `performance.timeOrigin + xrTime`), because the depth stream it joins
   * against is epoch (`DepthSample.timestamp = performance.timeOrigin + frameTs`,
   * `ar/depth-sampler.ts`) and the size as-of join pairs this with the depth
   * sample whose timestamp is `≤` this one (`ar/qr/qr-derived-pose`). A relative
   * `performance.now()` stamp (~1e5) never satisfies that join, so the size — and
   * the debug cube — never resolve. See the recorder live-QR plan open topic A.
   */
  timestamp: number;

  // --- RAW detector output (decision D-A, recorder live-QR plan) -----------
  // The authoritative, algorithm-agnostic shape: size + solved pose are DERIVED
  // from these on read (see `selectSolvedQrPose` → `ar/qr/qr-derived-pose.ts`). A
  // RAW producer (the Recorder) records ONLY these — the recording stays
  // algorithm-agnostic / re-testable. OPTIONAL because the legacy geo/demo
  // producer still records the solved pose below instead. See plan §3 / D-A.
  /** The 4 detected corners in detector-buffer PIXELS, order TL,TR,BR,BL. */
  corners?: readonly Point2[];
  /** Capturing camera pose in raw-WebXR/odom space (PnP camera-relative base). */
  cameraPose?: Pose;
  /** Column-major GL projection of the detector frame (→ PnP intrinsics). */
  projectionMatrix?: Matrix4;
  /** Detector-buffer width in pixels (to normalize corners + build intrinsics). */
  imageWidth?: number;
  /** Detector-buffer height in pixels. */
  imageHeight?: number;

  // --- SOLVED pose (legacy geo/demo producer) ------------------------------
  // OPTIONAL now (D-A): a RAW producer omits these and derives the pose on read.
  // The geo workflow + the QR-tracking demo still populate them, and the
  // `medianQrPosition` / pose-stability selectors consume them; an entry that
  // carries neither a solved pose NOR raw fields is degenerate.
  /** QR pose in raw-WebXR/odom space (rides `arWorldGroup`). */
  qrPoseWorld?: Pose;
  /** QR pose relative to the WebXR camera (pre-composition). */
  qrPoseInCamera?: Pose;
  /** RMS reprojection error in pixels (lower = better fit). */
  reprojectionErrorPx?: number;

  /**
   * The tracking-frame epoch the detection arrived in (M3b b2). STAMPED BY
   * THE REDUCER from {@link QrDetectedState.frameEpoch}; a value in the
   * payload is ignored, so a replay always reproduces the live partition.
   */
  frameEpoch?: number;
}

/** Per-marker state: a bounded detection history + the size lifecycle. */
export interface QrMarkerState {
  text: string;
  /** Bounded ring buffer, OLDEST first / NEWEST last. */
  detections: QrDetectionEntry[];
  size: QrSizeEstimate;
}

export interface QrDetectedState {
  /** Ring-buffer cap applied per marker on `recordQrDetection`. */
  maxHistory: number;
  /**
   * The current tracking-frame epoch: 0 at start, one more after every
   * odometry restart or loop closure (see {@link isQrFrameChangeAction}).
   * Detections from different epochs live in different coordinate frames
   * and must not be combined (QR near-frontal pose plan §16 #4). Absent
   * (state built or persisted before M3b b2) reads as 0.
   */
  frameEpoch?: number;
  /** Markers keyed by decoded payload. */
  markers: Record<string, QrMarkerState>;
}

const initialSize = (): QrSizeEstimate => ({
  status: 'unknown',
  estimateM: null,
  sampleCount: 0,
  spreadM: 0,
});

const initialState: QrDetectedState = {
  maxHistory: DEFAULT_QR_MAX_HISTORY,
  frameEpoch: 0,
  markers: {},
};

/**
 * Whether an action means the odometry frame moved: the recorded gpsData
 * restart / loop-closure actions (so old recordings replay it), the
 * session's own restart bookkeeping (`tracking/clearLastRestartedPayload`,
 * dispatched right after every restart into the store holding the tracking
 * slice), or this slice's own `qrFrameChanged`. One restart can arrive as
 * two of these in the same store; the epoch then moves twice with no
 * detection in between, which partitions the detections the same way.
 */
export function isQrFrameChangeAction(type: string): boolean {
  return (
    isSegmentingActionType(type) ||
    type === 'tracking/clearLastRestartedPayload' ||
    type === 'qrDetected/qrFrameChanged'
  );
}

/** Trim a detection list to at most `cap`, dropping the oldest. */
function capDetections(
  detections: readonly QrDetectionEntry[],
  cap: number
): QrDetectionEntry[] {
  if (cap <= 0) return [];
  return detections.length > cap
    ? detections.slice(detections.length - cap)
    : detections.slice();
}

const qrDetectedSlice = createSlice({
  name: 'qrDetected',
  initialState,
  reducers: {
    /**
     * Append a detection to its marker's ring buffer (creating the marker on
     * first sight), enforcing `maxHistory`. Returns a fresh state object rather
     * than mutating the immer draft: the entry's `Pose` carries readonly
     * `Vector3`/`Quaternion` tuples that immer's `WritableDraft` rejects (same
     * reason `tracking-slice.originReset` returns new state).
     */
    recordQrDetection(state, action: PayloadAction<QrDetectionEntry>) {
      const entry: QrDetectionEntry = {
        ...action.payload,
        frameEpoch: state.frameEpoch ?? 0,
      };
      const existing = state.markers[entry.text] as QrMarkerState | undefined;
      const detections = capDetections(
        existing ? [...existing.detections, entry] : [entry],
        state.maxHistory
      );
      const marker: QrMarkerState = {
        text: entry.text,
        detections,
        size: existing?.size ?? initialSize(),
      };
      return {
        ...state,
        markers: { ...state.markers, [entry.text]: marker },
      };
    },

    /**
     * Set a marker's size estimate (the Note 3 size lifecycle). Creates the
     * marker with an empty history if it has no detections yet (a size can be
     * authored before any detection).
     */
    recordQrSizeEstimate(
      state,
      action: PayloadAction<{ text: string; estimate: QrSizeEstimate }>
    ) {
      const { text, estimate } = action.payload;
      const existing = state.markers[text] as QrMarkerState | undefined;
      const marker: QrMarkerState = {
        text,
        detections: existing ? existing.detections.slice() : [],
        size: estimate,
      };
      return { ...state, markers: { ...state.markers, [text]: marker } };
    },

    /**
     * Drop the oldest `count` detections from one marker (explicit custom
     * cleanup, beyond the automatic ring-buffer cap). No-op for an unknown
     * marker or `count <= 0`.
     */
    pruneQrDetections(
      state,
      action: PayloadAction<{ text: string; count: number }>
    ) {
      const { text, count } = action.payload;
      const existing = state.markers[text] as QrMarkerState | undefined;
      if (!existing || count <= 0) return state;
      const marker: QrMarkerState = {
        ...existing,
        detections: existing.detections.slice(count),
      };
      return { ...state, markers: { ...state.markers, [text]: marker } };
    },

    /** Remove one marker entirely. */
    clearQrMarker(state, action: PayloadAction<{ text: string }>) {
      const { [action.payload.text]: _removed, ...rest } = state.markers;
      return { ...state, markers: rest };
    },

    /** Remove every marker (e.g. on session reset). */
    clearAllQrMarkers(state) {
      return { ...state, markers: {} };
    },

    /**
     * Change the ring-buffer cap. Existing markers are re-trimmed immediately
     * so the invariant "no marker exceeds `maxHistory`" holds at all times.
     */
    setQrMaxHistory(state, action: PayloadAction<number>) {
      const next = Math.max(0, Math.floor(action.payload));
      const markers: Record<string, QrMarkerState> = {};
      for (const [key, marker] of Object.entries(state.markers)) {
        markers[key] = {
          ...marker,
          detections: capDetections(marker.detections, next),
        };
      }
      return { ...state, maxHistory: next, markers };
    },

    /**
     * The odometry frame moved (restart, loop closure) in an app that
     * dispatches neither the gpsData actions nor the tracking slice's
     * restart bookkeeping. Handled by the frame-change matcher below.
     */
    qrFrameChanged() {
      // Intentionally empty: the matcher in extraReducers bumps the epoch,
      // so this action and the external ones share one code path.
    },
  },
  extraReducers: (builder) => {
    builder.addMatcher(
      (action: { type: string }) => isQrFrameChangeAction(action.type),
      (state) => ({ ...state, frameEpoch: (state.frameEpoch ?? 0) + 1 })
    );
  },
});

export const {
  recordQrDetection,
  recordQrSizeEstimate,
  pruneQrDetections,
  clearQrMarker,
  clearAllQrMarkers,
  setQrMaxHistory,
  qrFrameChanged,
} = qrDetectedSlice.actions;

export const qrDetectedReducer = qrDetectedSlice.reducer;

// --- Selectors ---------------------------------------------------------

/** Minimal root shape the selectors need (avoids a store import cycle). */
export interface RootWithQrDetected {
  qrDetected: QrDetectedState;
}

export function selectQrMarkers(
  state: RootWithQrDetected
): Record<string, QrMarkerState> {
  return state.qrDetected.markers;
}

export function selectQrMarker(
  state: RootWithQrDetected,
  text: string
): QrMarkerState | undefined {
  return state.qrDetected.markers[text];
}

/**
 * The newest detection for a marker (the natural overlay-persistence source —
 * an overlay reads this and keeps the last pose across detection misses rather
 * than unmounting/flickering).
 */
export function selectLatestQrDetection(
  state: RootWithQrDetected,
  text: string
): QrDetectionEntry | undefined {
  const marker = state.qrDetected.markers[text];
  if (!marker || marker.detections.length === 0) return undefined;
  return marker.detections[marker.detections.length - 1];
}

export function selectQrSize(
  state: RootWithQrDetected,
  text: string
): QrSizeEstimate | undefined {
  return state.qrDetected.markers[text]?.size;
}

/**
 * Resolve a marker's measured size for the high-weight GPS vote
 * (framework-wiring-options Part B, Option a). Returns the running-median
 * `estimateM` ONCE the size lifecycle reports `'estimated'`, else `null` ("keep
 * scanning"). This is the bridge an app injects as the QR controller's
 * `resolveSizeM`, so a size-less-but-geo level votes the moment the slice
 * converges — **without** the `ar` controller ever importing the slice (which
 * would close the `ar → state` cycle):
 *
 * ```ts
 * resolveSizeM: (text) => selectResolvedQrSizeM(store.getState(), text),
 * ```
 *
 * Per the Note 3 decision (confirmed) a reliably-estimated *measured* size
 * drives the vote under the *same* gate as an authored size — no extra
 * size-specific bar — because the §7 occupancy + reprojection + outlier-rejection
 * backstops already bound a bad read.
 */
export function selectResolvedQrSizeM(
  state: RootWithQrDetected,
  text: string
): number | null {
  const size = state.qrDetected.markers[text]?.size;
  return size?.status === 'estimated' ? size.estimateM : null;
}

// --- Derived helpers ---------------------------------------------------

/**
 * Robust per-axis median of the world positions across a marker's detection
 * window — the "running estimate" the bounded buffer enables (Note 3). Outliers
 * in fewer than half the samples cannot move the result outside the inlier
 * range. Skips RAW-only entries that carry no solved pose (D-A); returns `null`
 * for an empty window (or one with no solved poses at all).
 */
export function medianQrPosition(
  entries: readonly QrDetectionEntry[]
): Vector3 | null {
  const poses = entries
    .map((e) => e.qrPoseWorld)
    .filter((p): p is Pose => p !== undefined);
  if (poses.length === 0) return null;
  const xs = poses.map((p) => p.position[0]);
  const ys = poses.map((p) => p.position[1]);
  const zs = poses.map((p) => p.position[2]);
  return [lowerMedian(xs), lowerMedian(ys), lowerMedian(zs)];
}

/**
 * The pose-stability lifecycle for a marker, derived from its raw detection ring
 * buffer (NOT stored separately — the detections are the source of truth, unlike
 * the depth-measured size which is accumulated outside the buffer). Mirrors the
 * size lifecycle's `unknown → measuring → stable` shape so the HUD can show
 * "converging…" vs "stable". See `ar/qr/qr-pose-aggregation.ts`.
 */
export function selectQrPoseStability(
  state: RootWithQrDetected,
  text: string,
  options?: QrPoseStabilityOptions
): QrPoseStability {
  const marker = state.qrDetected.markers[text];
  const poses = marker
    ? marker.detections
        .map((d) => d.qrPoseWorld)
        .filter((p): p is Pose => p !== undefined)
    : [];
  return evaluateQrPoseStability(poses, options);
}

/**
 * The robust filtered QR world pose, exposed ONLY once the stability gate is
 * `stable` (else `null` — "keep accumulating"). This is the pose analogue of
 * {@link selectResolvedQrSizeM}: the `resolveStablePose`-style bridge an app
 * injects into the QR controller / demo so the `ar` layer never imports the
 * slice. The high-weight vote and the smooth overlay consume THIS, never the raw
 * latest pose (which stays available via {@link selectLatestQrDetection} for
 * scanning feedback / overlay persistence across misses).
 *
 * ```ts
 * resolveStablePose: (text) => selectStableQrPose(store.getState(), text),
 * ```
 */
export function selectStableQrPose(
  state: RootWithQrDetected,
  text: string,
  options?: QrPoseStabilityOptions
): Pose | null {
  const stability = selectQrPoseStability(state, text, options);
  return stability.status === 'stable' ? stability.pose : null;
}

// --- Derive-on-read (decision D-A) -------------------------------------

/**
 * Narrow a stored entry to a {@link RawQrObservation} — i.e. one that carries
 * the full raw detector output. During the D-A-2 transition some entries may
 * still be solved-pose-only (no raw fields); those are skipped by the derive
 * selector. After WS-3 every entry is raw and this guard always holds.
 */
function toRawObservation(entry: QrDetectionEntry): RawQrObservation | null {
  if (
    !entry.corners ||
    !entry.cameraPose ||
    !entry.projectionMatrix ||
    entry.imageWidth === undefined ||
    entry.imageHeight === undefined
  ) {
    return null;
  }
  return {
    text: entry.text,
    corners: entry.corners,
    cameraPose: entry.cameraPose,
    projectionMatrix: entry.projectionMatrix,
    imageWidth: entry.imageWidth,
    imageHeight: entry.imageHeight,
    timestamp: entry.timestamp,
  };
}

/**
 * Derive the best-effort solved WORLD pose for a marker from its RAW observation
 * history (decision D-A): accumulate size over the history against the injected
 * `resolveDepthAt` as-of join, then PnP-solve the latest observation. Returns
 * `null` when the marker is unknown, has no raw observations, cannot be sized
 * yet, or PnP rejects the latest quad — the re-test-friendly replacement for the
 * once-stored solved pose. Runs identically live and on replay (only
 * `deps.resolveDepthAt` differs). See `ar/qr/qr-derived-pose.ts`.
 */
export function selectSolvedQrPose(
  state: RootWithQrDetected,
  text: string,
  deps: DeriveQrPoseDeps
): Pose | null {
  const observations = selectQrRawObservations(state, text);
  return deriveSolvedQrPose(text, observations, deps);
}

/**
 * The marker's stored entries narrowed to {@link RawQrObservation}s (entries
 * carrying the full raw detector output), oldest→newest. Empty for an unknown
 * marker or one with only solved-pose-only (transitional) entries. This is the
 * shared mapping the derive-on-read selectors and the incremental deriver
 * consume — exposed so a stateful consumer (the recorder's debug controller)
 * can hand raw observations to `createIncrementalQrPlacement` without
 * re-implementing the `toRawObservation` guard.
 */
export function selectQrRawObservations(
  state: RootWithQrDetected,
  text: string
): RawQrObservation[] {
  const marker = state.qrDetected.markers[text];
  if (!marker) return [];
  return marker.detections
    .map(toRawObservation)
    .filter((o): o is RawQrObservation => o !== null);
}

/**
 * Derive the best-effort {@link DerivedQrPlacement} (solved pose AND the metric
 * size that solved it) for a marker from its RAW observation history. The debug
 * viz needs the size to draw the cube, so this returns both in one history pass
 * (decision D-A; see {@link deriveQrPlacement}). `null` under the same
 * conditions as {@link selectSolvedQrPose}. Runs identically live and on replay.
 */
export function selectDerivedQrPlacement(
  state: RootWithQrDetected,
  text: string,
  deps: DeriveQrPoseDeps
): DerivedQrPlacement | null {
  return deriveQrPlacement(text, selectQrRawObservations(state, text), deps);
}
