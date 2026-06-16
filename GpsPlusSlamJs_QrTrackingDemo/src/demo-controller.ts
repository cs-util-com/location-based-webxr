/**
 * QR-tracking demo controller — the orchestration brain (Note 4).
 *
 * Per throttled/coalesced frame it: detects a QR (front-end), measures the size
 * from depth via the shared framework {@link createQrSizeMeasurer} (samples the
 * corners + an interior point, accumulates a per-marker running median), and —
 * once a size estimate EXISTS — solves the QR pose with the production PnP path
 * (`solveQrPose`/`OpenCvPnpSquare`, injected as {@link solvePose}). On the
 * N-consecutive-lock it records the detection into the `qrDetected` store and
 * glues the debug axis + cube to the pose.
 *
 * `depth → size → PnP` gate (see
 * `GpsPlusSlamJs_Docs/docs/2026-06-16-qr-demo-pnp-conversion-plan.md`): the PnP
 * solve needs a physical size, so no pose (hence no axis/cube) is produced until a
 * size estimate exists (`estimateM !== null`, i.e. the first accepted depth
 * sample) — mirroring production, whose controller blocks the solve on a `null`
 * size. It does NOT wait for the vote-grade `estimated` lifecycle: that bar gates
 * the high-weight GPS vote (never cast here), and on noisy device depth it is
 * rarely met, so gating the overlay on it left nothing ever glued. The size
 * estimate is dispatched EVERY measured frame (not only on a lock) so the HUD
 * shows the running median + convergence progress independently of the lock.
 *
 * The pose math is fully delegated to the injected {@link solvePose} closure
 * (production: `solveQrPose` backed by `OpenCvPnpSquare`; tests inject a fake), so
 * this module needs no OpenCV and the whole flow is unit-testable without WebXR, a
 * camera, or depth hardware. It is geo-less: no GPS vote is ever cast.
 */

import {
  createDetectionScheduler,
  createQrSizeMeasurer,
  estimateQrSizeFromDepth,
  intrinsicsFromProjection,
  validateQuad,
  type DetectionScheduler,
  type RgbaImage,
  type QrDetection,
  type Point2,
  type Pose,
  type DepthUnprojector,
  type QrSizeEstimate,
  type QrSizeStatus,
  type QrSizeMeasurer,
  type QrDetectionEvent,
  type QrSolvePoseInput,
  type QrPoseSolution,
} from "gps-plus-slam-app-framework/ar";
import type { Matrix4 } from "gps-plus-slam-app-framework/core";
import type { DemoStatus } from "./hud-view.js";

/** Solve the QR world pose from corners + size + intrinsics (production: wraps
 * `solveQrPose` with an `OpenCvPnpSquare`). `null` when the solve is rejected
 * (degenerate, behind camera, reprojection over threshold) or unavailable. */
export type SolvePoseFn = (input: QrSolvePoseInput) => QrPoseSolution | null;

/** Everything device-specific the controller needs to read one frame's depth. */
export interface DepthContext {
  /** Unprojector for the current depth sample (`createDepthUnprojector`). */
  unprojector: DepthUnprojector;
  /** Depth (m) at a normalized screen point, or `null` if unavailable there. */
  depthAt: (screenX: number, screenY: number) => number | null;
  /** Camera pose in raw-WebXR/odom space (for the PnP world composition). */
  cameraPose: Pose;
  /** Column-major XRView projection of the detector buffer — for intrinsics. */
  projectionMatrix: Matrix4;
}

/**
 * Per-frame diagnostics for the on-device "0 samples / nothing glued"
 * investigation (see the tuning-overlay plan). Emitted once per processed frame
 * at every decision point so the on-screen log can show WHY a frame did not
 * accept a sample / lock. `null` fields mean "not evaluated this far".
 */
export interface QrFrameDiagnostics {
  /** A QR was detected + decoded this frame. */
  detected: boolean;
  /** Decoded payload, or `null` when nothing was detected. */
  text: string | null;
  /** `validateQuad` passed (false = mirrored/degenerate; null = not reached). */
  quadValid: boolean | null;
  /** A depth context was available this frame (null = not reached). */
  hasDepthContext: boolean | null;
  /** How many of the 4 corners resolved a finite, positive depth (0–4; null = not reached). */
  depthCornerHits: number | null;
  /** This frame's RAW depth-derived size (m), or null (unproject failed / not reached). */
  sizeM: number | null;
  /** This frame's RAW observation quality [0,1], or null (not reached). */
  quality: number | null;
  /** Did the size accumulator ACCEPT this frame's observation. */
  accepted: boolean;
  /** Accepted-sample count backing the running median. */
  sampleCount: number;
  /** Size lifecycle stage, or `'no-detection'`. */
  status: QrSizeStatus | "no-detection";
  /** PnP solve ran and succeeded (false = rejected; null = not reached). */
  solved: boolean | null;
  /** RMS reprojection error (px) when solved, else null. */
  reprojectionErrorPx: number | null;
  /** Single-line verdict / rejection reason for the log. */
  reason: string;
}

export interface QrDemoControllerDeps {
  /** Detect + decode (BarcodeDetector front-end fed by `captureToPixels`). */
  detect: (image: RgbaImage) => Promise<QrDetection | null>;
  /** The current frame's depth context, or `null` when depth is unavailable. */
  getDepthContext: () => DepthContext | null;
  /**
   * Solve the QR pose via the production PnP path. `undefined`/returns `null`
   * while the solver is unavailable (e.g. OpenCV still loading) — the controller
   * then stays `scanning` rather than placing anything (graceful degrade).
   */
  solvePose?: SolvePoseFn;
  /** Dispatch `recordQrDetection` (Note 3 slice). */
  recordDetection: (event: QrDetectionEvent) => void;
  /** Dispatch `recordQrSizeEstimate` (Note 3 size lifecycle) — every measured frame. */
  recordSize: (text: string, estimate: QrSizeEstimate) => void;
  /** Glue the debug axis + cube to the pose at the measured size (or `null`). */
  updateScene: (pose: Pose, sizeM: number | null) => void;
  /**
   * Resolve the STABLE (sliding-window filtered) world pose for the OVERLAY —
   * e.g. `selectStableQrPose(store.getState(), text)`. When wired, the rendered
   * axis/cube use the filtered pose so they stop swinging between throttled
   * detections; a `null` (not yet converged) falls back to this frame's raw PnP
   * pose so the overlay still appears while the window fills. `recordDetection`
   * runs first, so the window this reads already includes the current frame.
   */
  resolveStablePose?: (text: string) => Pose | null;
  /** Status-change notifications for the HUD. */
  onStatus?: (status: DemoStatus) => void;
  /**
   * Per-frame diagnostics for on-device root-causing (depth coverage, raw
   * size/quality, accept/reject reason). Emitted once per processed frame.
   */
  onFrameDiagnostics?: (diagnostics: QrFrameDiagnostics) => void;
  /** Injectable clock (ms) for the detection timestamp + scheduler. */
  now?: () => number;
  /** Scheduler tuning. */
  minIntervalMs?: number;
  requiredLockCount?: number;
}

export interface QrDemoController {
  /** Offer the latest camera frame; throttled/coalesced internally. */
  offerFrame(image: RgbaImage): void;
  readonly status: DemoStatus;
  /** Clear the measured-size accumulators and return to idle. */
  reset(): void;
}

interface DemoLockResult {
  event: QrDetectionEvent;
  pose: Pose;
  estimate: QrSizeEstimate;
}

export function createQrDemoController(
  deps: QrDemoControllerDeps,
): QrDemoController {
  const {
    detect,
    getDepthContext,
    solvePose,
    recordDetection,
    recordSize,
    updateScene,
    resolveStablePose,
    onStatus,
    onFrameDiagnostics,
    now,
    minIntervalMs = 0,
    requiredLockCount = 2,
  } = deps;

  const timestampNow = now ?? (() => Date.now());
  // The shared framework piece: per-marker depth→size accumulation (Part B,
  // Option 2). Both this demo and the Recorder wire the same measurer.
  const measurer: QrSizeMeasurer = createQrSizeMeasurer();
  // Per-marker accepted-sample count from the previous frame, so each frame's
  // diagnostics can report whether THIS observation was accepted (count grew).
  const lastSampleCount = new Map<string, number>();
  let status: DemoStatus = "idle";

  function setStatus(next: DemoStatus): void {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  /** Emit a frame diagnostics record (no-op when no consumer is wired). */
  function emitDiag(partial: Partial<QrFrameDiagnostics>): void {
    if (!onFrameDiagnostics) return;
    onFrameDiagnostics({
      detected: false,
      text: null,
      quadValid: null,
      hasDepthContext: null,
      depthCornerHits: null,
      sizeM: null,
      quality: null,
      accepted: false,
      sampleCount: 0,
      status: "no-detection",
      solved: null,
      reprojectionErrorPx: null,
      reason: "",
      ...partial,
    });
  }

  async function runDetect(image: RgbaImage): Promise<DemoLockResult | null> {
    if (status === "idle") setStatus("scanning");

    const detection = await detect(image);
    if (!detection) {
      emitDiag({ reason: "no QR" });
      return null;
    }

    // Reject a mirrored winding or a degenerate quad up front (the same guards
    // `solveQrPose` applies), so we never measure or solve a bad read. It does
    // NOT reorder corners — the detector's order carries the QR's reading
    // orientation (see the on-device follow-up §2.3).
    if (!validateQuad(detection.corners).ok) {
      emitDiag({
        detected: true,
        text: detection.text,
        quadValid: false,
        reason: "degenerate/mirrored quad",
      });
      return null;
    }

    const ctx = getDepthContext();
    if (!ctx) {
      emitDiag({
        detected: true,
        text: detection.text,
        quadValid: true,
        hasDepthContext: false,
        reason: "no depth context",
      });
      return null; // no depth → cannot size (auto-size gate)
    }

    // Depth coverage diagnostic: how many corners resolve a usable depth. This
    // is independent of the measurer (which fails wholesale on the first missing
    // corner) and is the key signal for the on-device "0 samples" investigation:
    // `< 4` ⇒ the (sparse/stale) depth grid has no usable read at the corners.
    const depthCornerHits = countDepthHits(
      detection.corners,
      image,
      ctx.depthAt,
    );

    // Measure size from depth (samples the 4 corners + centroid). `null` means a
    // corner lacked a depth read (cannot size this frame).
    const measurement = measurer.measure(
      detection.text,
      detection.corners,
      image,
      ctx,
    );
    if (!measurement) {
      emitDiag({
        detected: true,
        text: detection.text,
        quadValid: true,
        hasDepthContext: true,
        depthCornerHits,
        reason: `corner depth missing (${depthCornerHits}/4)`,
      });
      return null;
    }

    const estimate = measurement.estimate;
    // Record the size EVERY measured frame, independent of the lock, so the HUD
    // shows "measuring… N samples" progress.
    recordSize(detection.text, estimate);

    // Recompute the RAW observation (cheap, diagnostics-only) so the log shows
    // this frame's size + quality even when the accumulator rejected it (quality
    // below threshold) — the discriminator between "depth noisy" and "depth fine
    // but the quality gate is too strict".
    const observation = estimateQrSizeFromDepth(
      measurement.cornerSamples,
      measurement.interiorSamples,
      ctx.unprojector,
    );
    const prevCount = lastSampleCount.get(detection.text) ?? 0;
    const accepted = estimate.sampleCount > prevCount;
    lastSampleCount.set(detection.text, estimate.sampleCount);

    const baseDiag: Partial<QrFrameDiagnostics> = {
      detected: true,
      text: detection.text,
      quadValid: true,
      hasDepthContext: true,
      depthCornerHits,
      sizeM: observation?.sizeM ?? null,
      quality: observation?.quality ?? null,
      accepted,
      sampleCount: estimate.sampleCount,
      status: estimate.status,
    };

    // `depth → size → PnP` gate: block the solve only while NO size exists yet
    // (`estimateM === null`), mirroring the production controller, which blocks on
    // a `null` size (see `qr-tracking-controller`). `SOLVEPNP_IPPE_SQUARE` rotation
    // is size-invariant and translation scales with size, so the provisional
    // running median — available from the first accepted sample — is a valid size
    // that simply refines as more samples land. We deliberately do NOT wait for
    // the vote-grade `estimated` lifecycle: that bar (≥8 quality-≥0.8 samples
    // within a 1 cm spread) gates the high-weight GPS *vote*, which this geo-less
    // demo never casts, and on noisy on-device depth it is rarely met — so gating
    // the overlay on it left nothing ever glued (the bug this fixes).
    if (estimate.estimateM === null) {
      emitDiag({
        ...baseDiag,
        reason:
          observation === null
            ? "unproject failed (corner depth ≤0 / non-finite)"
            : `low quality ${observation.quality.toFixed(2)} — no sample yet`,
      });
      return null;
    }
    const sizeM = estimate.estimateM;

    // PnP requires a solver; absent (OpenCV unavailable / still loading) → we
    // cannot place anything this frame, stay scanning.
    if (!solvePose) {
      emitDiag({ ...baseDiag, reason: "no solver (OpenCV loading)" });
      return null;
    }

    const intrinsics = intrinsicsFromProjection(
      ctx.projectionMatrix,
      image.width,
      image.height,
    );
    const solution = solvePose({
      imagePoints: detection.corners,
      sizeM,
      intrinsics,
      cameraPose: ctx.cameraPose,
    });
    if (!solution) {
      emitDiag({
        ...baseDiag,
        solved: false,
        reason: "PnP rejected (reproj / degenerate / behind camera)",
      });
      return null;
    }

    emitDiag({
      ...baseDiag,
      solved: true,
      reprojectionErrorPx: solution.reprojectionErrorPx,
      reason: `solved (reproj ${solution.reprojectionErrorPx.toFixed(1)}px)`,
    });

    const event: QrDetectionEvent = {
      text: detection.text,
      qrPoseWorld: solution.qrPoseWorld,
      qrPoseInCamera: solution.qrPoseInCamera,
      reprojectionErrorPx: solution.reprojectionErrorPx,
      timestamp: timestampNow(),
    };
    return { event, pose: solution.qrPoseWorld, estimate };
  }

  const scheduler: DetectionScheduler =
    createDetectionScheduler<DemoLockResult>({
      detect: runDetect,
      minIntervalMs,
      requiredLockCount,
      ...(now ? { now } : {}),
      onLocked: (result) => {
        recordDetection(result.event);
        // Render the windowed stable pose when available (smooth overlay); fall
        // back to the raw PnP frame pose while the window is still converging.
        const renderPose =
          resolveStablePose?.(result.event.text) ?? result.pose;
        updateScene(renderPose, result.estimate.estimateM);
        setStatus("tracking");
      },
      // Note 3 persistence: on a miss we do NOT clear the scene — the axis + cube
      // keep their last pose so they don't flicker between throttled detections.
      onMiss: () => {
        if (status === "tracking") setStatus("scanning");
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
      measurer.reset();
      lastSampleCount.clear();
      setStatus("idle");
    },
  };
}

/**
 * Count how many of the (4) detected corners resolve a finite, positive depth —
 * the depth-coverage diagnostic. Mirrors the measurer's per-corner sampling
 * (`corner / imageDim` → normalized screen point), but reports the count instead
 * of failing wholesale, so the on-screen log can distinguish "no depth at the
 * corners" from "depth present but the size quality is too low".
 */
function countDepthHits(
  corners: readonly Point2[],
  image: { width: number; height: number },
  depthAt: (screenX: number, screenY: number) => number | null,
): number {
  let hits = 0;
  for (const c of corners) {
    const d = depthAt(c.x / image.width, c.y / image.height);
    if (d !== null && Number.isFinite(d) && d > 0) hits++;
  }
  return hits;
}
