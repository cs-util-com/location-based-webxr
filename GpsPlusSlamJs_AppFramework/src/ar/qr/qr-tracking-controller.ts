/**
 * QR tracking controller — Phase 6 of the QR-code detection & tracking plan.
 *
 * The orchestration "brain" of the demonstrator, reusable across apps: it wires
 * a {@link QrFrontEnd} → level-file fetch (§8) → pose solve (§1/§5) → the
 * synthetic GPS-vote bridge (§6), driven at a throttled, coalesced cadence by
 * {@link createDetectionScheduler}, and exposes a small async-status state
 * machine so the UI can satisfy the "feedback for async actions" rule:
 *
 *   idle → scanning → loading-level → tracking, with `error` on any failure.
 *
 * Every heavy/external step (detect, level fetch, pose solve, vote dispatch,
 * camera pose / intrinsics access) is injected, so the controller is pure logic
 * and fully unit-testable without WASM, a device, or a real store.
 */

import type { RecordGpsEventPayload } from 'gps-plus-slam-js';
import type {
  CameraIntrinsics,
  Point2,
  Pose,
  QrPoseSolution,
} from './qr-pose.js';
import type { QrFrontEnd, RgbaImage } from './qr-frontend.js';
import type { QrLevel } from './qr-level.js';
import { buildQrGpsVotes } from './qr-gps-vote.js';
import { validateQuad } from './qr-pose.js';
import {
  createDetectionScheduler,
  type DetectionScheduler,
} from './detection-scheduler.js';

export type QrTrackingStatus =
  | 'idle'
  | 'scanning'
  | 'loading-level'
  | 'tracking'
  | 'error';

/** Inputs to the injected pose solve (so the controller doesn't import OpenCV). */
export interface QrSolvePoseInput {
  imagePoints: readonly Point2[];
  sizeM: number;
  intrinsics: CameraIntrinsics;
  cameraPose: Pose;
}

/**
 * Emitted on every lock, INDEPENDENTLY of the GPS vote (Note 3). The app maps
 * this onto `recordQrDetection` of the `qrDetected` slice. Kept structural (no
 * import of the state slice) so the `ar` layer never depends on `state` — that
 * would close a cycle (`state/qr-detected-slice` already imports `ar/qr/qr-pose`).
 */
/** A validated decode, before any level or size is involved. Not exported:
 *  it appears in an exported callback signature, so consumers get it by
 *  inference, and a named export nothing imports is what the dead-code check
 *  flags. */
interface QrRawDetection {
  readonly text: string;
  readonly corners: readonly Point2[];
  readonly cameraPose: Pose;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly timestamp: number;
}

export interface QrDetectionEvent {
  /**
   * The detector's four corners, the camera pose and the image size — the
   * RAW facts behind the solve.
   *
   * They are here so an app that wants BOTH a solved pose and a raw record
   * (the recorder, which must keep recording raw whatever else it does) gets
   * them from ONE decode. Running the thin producer alongside this controller
   * would decode every frame twice, on the AR frame path.
   *
   * The projection matrix is deliberately NOT here: this controller never
   * sees one — it is given `getIntrinsics(image)` instead — and inventing a
   * field it cannot fill would be worse than the caller supplying its own.
   */
  readonly corners: readonly Point2[];
  readonly cameraPose: Pose;
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** Decoded payload (text/URL) — the marker key. */
  text: string;
  qrPoseWorld: Pose;
  qrPoseInCamera: Pose;
  reprojectionErrorPx: number;
  /** Epoch ms (or the injected clock) when the lock fired. */
  timestamp: number;
}

export interface QrTrackingControllerConfig {
  /** Detect + decode (BarcodeDetector / OpenCV front-end). */
  frontEnd: QrFrontEnd;
  /** Solve the QR world pose from corners (production: wraps `solveQrPose`). */
  solvePose: (input: QrSolvePoseInput) => QrPoseSolution | null;
  /** Fetch + validate a level file from the decoded URL (cached by the controller). */
  fetchLevel: (url: string) => Promise<QrLevel>;
  /** Dispatch the synthetic GPS votes (production: `recordGpsEvent` per payload). */
  dispatchVotes: (votes: RecordGpsEventPayload[]) => void;
  /**
   * Emitted on every lock, independent of the vote (Note 3). Apps wire this to
   * `dispatch(recordQrDetection(event))`. The vote is conditional on `geo`;
   * this emission is not.
   */
  onDetection?: (event: QrDetectionEvent) => void;
  /**
   * Every VALIDATED decode, before the level fetch and before the size gate.
   *
   * Separate from {@link onDetection} on purpose: that one fires on a LOCKED,
   * solved pose, which needs a physical size, which needs a level. A consumer
   * that records raw observations must capture every decode regardless —
   * including a code whose level does not exist yet, which is exactly the
   * state an authoring walk is in.
   */
  onRawDetection?: (detection: QrRawDetection) => void;
  /**
   * Whether a fetched level may be cached for the rest of the session.
   *
   * Defaults to caching everything, which is right for a static
   * `fetchLevel`. A source that retries — because "could not reach it" is a
   * different answer from "there is no level here" — returns `false` for the
   * answers it intends to revisit, and owns the timing itself.
   */
  shouldCacheLevel?: (level: QrLevel) => boolean;
  /**
   * Resolve the physical size (m) when the level omits `physicalSizeM` — e.g. a
   * depth-measured running median (Note 4). Returns `null` while size is still
   * unknown, which BLOCKS the pose solve (and therefore the vote + detection
   * emission) until a size is authored or measured-and-locked (the Note 3 size
   * lifecycle gate). Ignored when the level already carries `physicalSizeM`.
   */
  resolveSizeM?: (text: string, level: QrLevel) => number | null;
  /**
   * Resolve the STABLE (sliding-window filtered) world pose for the vote — e.g.
   * `selectStableQrPose(store.getState(), text)`. Returns `null` until the pose
   * has converged, which GATES the high-weight vote (the detection emission is
   * unconditional; only the vote waits for stability). When omitted (back-compat)
   * the raw single-frame solve pose drives the vote.
   *
   * Ordering: the `onDetection` emission above feeds this frame's RAW pose into
   * the slice synchronously, so the window this reads already includes it. See
   * the sliding-window stabilization design doc.
   */
  resolveStablePose?: (text: string) => Pose | null;
  /** Current camera pose in raw-WebXR/odom space, or `null` if unavailable. */
  getCameraPose: () => Pose | null;
  /** Intrinsics for the exact frame buffer, or `null` if unavailable. */
  getIntrinsics: (image: RgbaImage) => CameraIntrinsics | null;
  /** Synthetic GPS accuracy (m) → vote weight. */
  syntheticAccuracyM: number;
  /**
   * Optional wide-baseline north-stiffness knob (Note 2), forwarded to
   * `buildQrGpsVotes`. `voteBaselineM > 0` synthesizes the correspondences on a
   * polygon of that radius (stiffer rotation fit); `voteCount` (≥3) sets how
   * many. Leave unset for the default physical-corner mode. Treat as a bounded
   * tuning knob — a larger count makes a bad detection harder to outlier-reject.
   */
  voteBaselineM?: number;
  voteCount?: number;
  /** Optional plausibility gate (e.g. occupancy self-check); `false` rejects. */
  isPlausible?: (solution: QrPoseSolution, cameraPose: Pose) => boolean;
  /** Status-change notifications for the UI. */
  onStatus?: (status: QrTrackingStatus) => void;
  /** Called each time a locked detection dispatches votes. */
  onLocked?: (solution: QrPoseSolution, level: QrLevel) => void;
  /** Surfaced failures (level fetch, detect throw). */
  onError?: (err: unknown) => void;
  /** Scheduler tuning (see `detection-scheduler.ts`). */
  minIntervalMs?: number;
  requiredLockCount?: number;
  now?: () => number;
}

export interface QrTrackingController {
  /** Offer the latest camera frame; throttled/coalesced internally. */
  offerFrame(image: RgbaImage): void;
  /** Current status. */
  readonly status: QrTrackingStatus;
  /** Stop tracking and reset to `idle` (clears the level cache). */
  reset(): void;
}

export function createQrTrackingController(
  config: QrTrackingControllerConfig
): QrTrackingController {
  const {
    frontEnd,
    solvePose,
    fetchLevel,
    dispatchVotes,
    onDetection,
    onRawDetection,
    shouldCacheLevel,
    resolveSizeM,
    resolveStablePose,
    getCameraPose,
    getIntrinsics,
    syntheticAccuracyM,
    voteBaselineM,
    voteCount,
    isPlausible,
    onStatus,
    onLocked,
    onError,
    minIntervalMs = 150,
    requiredLockCount = 3,
    now,
  } = config;

  const timestampNow = now ?? (() => Date.now());

  let status: QrTrackingStatus = 'idle';
  const levelCache = new Map<string, QrLevel>();
  // The level + payload + resolved size from the in-flight detection, read by
  // onLocked to emit the detection and (conditionally) build the vote.
  // Carries the RAW facts of the solve as well as the level, so `onLocked`
  // can hand them to a consumer that needs a raw record alongside the pose
  // — without a second decode of the same frame.
  let active: {
    level: QrLevel;
    text: string;
    sizeM: number;
    corners: readonly Point2[];
    cameraPose: Pose;
    imageWidth: number;
    imageHeight: number;
  } | null = null;

  function setStatus(next: QrTrackingStatus): void {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  async function ensureLevel(url: string): Promise<QrLevel> {
    const cached = levelCache.get(url);
    if (cached) return cached;
    setStatus('loading-level');
    const level = await fetchLevel(url);
    // A source that owns its own retry policy says so. Without this the
    // controller caches the first answer forever, and a source's backoff -
    // built precisely so one transient failure does not poison a code for the
    // rest of a session - becomes unreachable: the retry is never asked for.
    if (shouldCacheLevel === undefined || shouldCacheLevel(level)) {
      levelCache.set(url, level);
    }
    return level;
  }

  async function detect(image: RgbaImage): Promise<QrPoseSolution | null> {
    if (status === 'idle' || status === 'error') setStatus('scanning');

    const detection = await frontEnd.detect(image);
    if (!detection) {
      active = null;
      return null;
    }

    // The RAW record is emitted HERE — on a validated decode, before the level
    // is fetched and before the size gate. It must not depend on either: a
    // consumer that records raw observations (decision D-A) has to capture
    // every decode a session saw, including codes whose level is missing,
    // unreachable, or not yet authored. Gating it on a solved pose, as an
    // earlier draft did, meant the FIRST recording of an authoring walk -
    // where no level exists yet, by definition - recorded nothing at all.
    //
    // `validateQuad` mirrors the thin producer: keep a mirrored or degenerate
    // read out of the recording.
    const rawCameraPose = getCameraPose();
    if (onRawDetection && rawCameraPose && validateQuad(detection.corners).ok) {
      onRawDetection({
        text: detection.text,
        corners: detection.corners,
        cameraPose: rawCameraPose,
        imageWidth: image.width,
        imageHeight: image.height,
        timestamp: timestampNow(),
      });
    }

    const level = await ensureLevel(detection.text);

    // Size lifecycle gate (Note 3): authored size wins; else ask the resolver
    // (e.g. a depth-measured median). A `null`/absent size blocks the solve —
    // we cannot place the QR in 3D without it — so we stay scanning.
    const sizeM =
      level.qr.physicalSizeM ?? resolveSizeM?.(detection.text, level) ?? null;
    // A degenerate measured size (0, negative, NaN, Infinity) is treated exactly
    // like an absent one: `resolveSizeM` is an injected boundary that can yield
    // such values before it converges, and forwarding them to `solvePose`
    // (→ `buildObjectPoints`) throws a RangeError that would wedge the controller
    // in the terminal `error` state. Block the solve and stay scanning instead.
    if (sizeM === null || !(sizeM > 0) || !Number.isFinite(sizeM)) {
      active = null;
      // We fetched the level but can't place the QR without a size; fall back
      // to scanning rather than sticking on 'loading-level'. Size-dependent
      // features stay blocked until a size is authored/measured (Note 3).
      if (status === 'loading-level') setStatus('scanning');
      return null;
    }

    // The pose sampled WITH THE FRAME, not a fresh one. `detection.corners`
    // come from `image`, and `qrPoseWorld` is `cameraPose o qrPoseInCamera`,
    // so the two must describe the same instant. Re-sampling here paired the
    // old frame's corners with a pose from AFTER `ensureLevel` - on a code's
    // first sighting that await is a real network round trip (the level
    // source opens a remote archive under a 15 s deadline), so the code got
    // anchored wherever the phone had moved to (PR #379 review). It also
    // made the raw record and the solved pose describe one detection with
    // two different poses.
    const cameraPose = rawCameraPose;
    const intrinsics = getIntrinsics(image);
    if (!cameraPose || !intrinsics) {
      active = null;
      return null;
    }

    const solution = solvePose({
      imagePoints: detection.corners,
      sizeM,
      intrinsics,
      cameraPose,
    });
    if (!solution) {
      active = null;
      return null;
    }
    if (isPlausible && !isPlausible(solution, cameraPose)) {
      active = null;
      return null;
    }

    active = {
      level,
      text: detection.text,
      sizeM,
      corners: detection.corners,
      cameraPose,
      imageWidth: image.width,
      imageHeight: image.height,
    };
    return solution;
  }

  const scheduler: DetectionScheduler =
    createDetectionScheduler<QrPoseSolution>({
      detect,
      minIntervalMs,
      requiredLockCount,
      now,
      onLocked: (solution) => {
        const current = active;
        if (!current) return;
        const { level, text, sizeM } = current;

        // qrDetected emission is UNCONDITIONAL (Note 3): overlay/trigger/anchor
        // consumers subscribe regardless of whether this QR carries geo.
        onDetection?.({
          text,
          qrPoseWorld: solution.qrPoseWorld,
          qrPoseInCamera: solution.qrPoseInCamera,
          reprojectionErrorPx: solution.reprojectionErrorPx,
          timestamp: timestampNow(),
          corners: current.corners,
          cameraPose: current.cameraPose,
          imageWidth: current.imageWidth,
          imageHeight: current.imageHeight,
        });

        // The GPS vote is CONDITIONAL on geo: geo-less levels (debug/observe,
        // trigger, AR-root-anchored spawn) emit the detection but cast no vote.
        if (level.qr.geo) {
          // Stability gate (sliding-window stabilization): when a resolver is
          // wired, vote on the FILTERED pose and skip the vote entirely until it
          // converges (`null`). Without a resolver, the raw solve pose is used.
          const votePose = resolveStablePose
            ? resolveStablePose(text)
            : solution.qrPoseWorld;
          if (votePose) {
            const votes = buildQrGpsVotes({
              qrPoseWorld: votePose,
              sizeM,
              qrGeo: level.qr.geo,
              syntheticAccuracyM,
              ...(voteBaselineM !== undefined
                ? { baselineM: voteBaselineM }
                : {}),
              ...(voteCount !== undefined ? { count: voteCount } : {}),
            });
            dispatchVotes(votes);
          }
        }

        setStatus('tracking');
        onLocked?.(solution, level);
      },
      onMiss: () => {
        // Back to scanning unless an error is showing.
        if (status === 'tracking') setStatus('scanning');
      },
      onError: (err) => {
        active = null;
        setStatus('error');
        onError?.(err);
      },
    });

  return {
    offerFrame(image: RgbaImage): void {
      scheduler.offerFrame(image);
    },
    get status() {
      return status;
    },
    reset(): void {
      levelCache.clear();
      active = null;
      setStatus('idle');
    },
  };
}
