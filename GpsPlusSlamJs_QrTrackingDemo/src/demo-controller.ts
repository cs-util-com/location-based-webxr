/**
 * QR-tracking demo controller — the orchestration brain (Note 4).
 *
 * Per throttled/coalesced frame it: detects a QR (front-end), measures the size
 * from depth via the shared framework {@link createQrSizeMeasurer} (samples the
 * corners + an interior point, accumulates a per-marker running median), and —
 * once a size EXISTS — solves the full pose with the framework's pure-JS PnP
 * ({@link solveQrPose} + {@link PlanarPnpSquare}, position AND rotation from the
 * detected corner pixels). On the N-consecutive-lock it records the detection +
 * size into the `qrDetected` store and glues the debug axis + cube to the pose.
 *
 * The pose is now PnP, not the depth-corner rigid fit — so rotation no longer
 * inherits per-corner depth noise. Depth is still used for the SIZE (the metric
 * scale PnP needs); the relaxed gate places as soon as a size exists
 * (`estimateM !== null`), the lever that actually glued on-device. The size
 * measurer still returns the corner depth samples, but this controller no longer
 * consumes them (the depth-corner pose fit was retired once on-device confirmed
 * PnP translation is robust).
 *
 * Every device-specific dependency (detect, depth context, the pose solve, store
 * dispatch, scene update) is injected, so this whole flow is unit-testable
 * without WebXR, a camera, or depth hardware. It is geo-less: no GPS vote is
 * ever cast.
 */

import {
  createDetectionScheduler,
  createQrSizeMeasurer,
  intrinsicsFromProjection,
  solveQrPose,
  PlanarPnpSquare,
  validateQuad,
  type DetectionScheduler,
  type RgbaImage,
  type QrDetection,
  type Pose,
  type QrSizeDepthContext,
  type QrSizeEstimate,
  type QrSizeMeasurer,
  type QrDetectionEvent,
  type QrPoseSolution,
  type SolveQrPoseInput,
} from "gps-plus-slam-app-framework/ar";
import type { Matrix4 } from "gps-plus-slam-app-framework/core";
import type { DemoStatus } from "./hud-view.js";

/** The framework pose solve, minus the injected solver (which the demo owns). */
export type DemoSolvePose = (
  input: Omit<SolveQrPoseInput, "solver">,
) => QrPoseSolution | null;

/**
 * Everything device-specific the controller needs to read one frame's depth:
 * the shared framework size-measurer context (unprojector + depthAt — the demo's
 * seams already build it via `createQrSizeDepthContext`) plus the two per-frame
 * fields only the PnP solve needs.
 */
export interface DepthContext extends QrSizeDepthContext {
  /** Camera pose in raw-WebXR/odom space (for the camera-relative pose). */
  cameraPose: Pose;
  /**
   * The view projection matrix for the detector frame — PnP intrinsics come from
   * `intrinsicsFromProjection(projectionMatrix, image.width, image.height)`. The
   * corners and this matrix MUST describe the same buffer (the #1 PnP risk).
   */
  projectionMatrix: Matrix4;
}

export interface QrDemoControllerDeps {
  /** Detect + decode (BarcodeDetector front-end fed by `captureToPixels`). */
  detect: (image: RgbaImage) => Promise<QrDetection | null>;
  /** The current frame's depth context, or `null` when depth is unavailable. */
  getDepthContext: () => DepthContext | null;
  /** Dispatch `recordQrDetection` (Note 3 slice). */
  recordDetection: (event: QrDetectionEvent) => void;
  /** Dispatch `recordQrSizeEstimate` (Note 3 size lifecycle). */
  recordSize: (text: string, estimate: QrSizeEstimate) => void;
  /** Glue the debug axis + cube to the pose at the measured size (or `null`). */
  updateScene: (pose: Pose, sizeM: number | null) => void;
  /**
   * Solve the QR pose from corners + size + intrinsics. Defaults to the
   * framework `solveQrPose` with a pure-JS {@link PlanarPnpSquare}; injectable so
   * tests can drive the scene with a canned pose (no reprojection-gate setup).
   */
  solvePose?: DemoSolvePose;
  /**
   * Resolve the STABLE (sliding-window filtered) world pose for the OVERLAY —
   * e.g. `selectStableQrPose(store.getState(), text)`. When wired, the rendered
   * axis/cube use the filtered pose so they stop swinging between throttled
   * detections; a `null` (not yet converged) falls back to this frame's raw pose
   * so the overlay still appears while the window fills. `recordDetection` runs
   * first, so the window this reads already includes the current frame.
   */
  resolveStablePose?: (text: string) => Pose | null;
  /** Status-change notifications for the HUD. */
  onStatus?: (status: DemoStatus) => void;
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
    recordDetection,
    recordSize,
    updateScene,
    resolveStablePose,
    onStatus,
    now,
    minIntervalMs = 0,
    requiredLockCount = 2,
  } = deps;

  const timestampNow = now ?? (() => Date.now());
  // The shared framework piece: per-marker depth→size accumulation (Part B,
  // Option 2). Both this demo and the Recorder wire the same measurer.
  const measurer: QrSizeMeasurer = createQrSizeMeasurer();
  // Default pose solve: the framework PnP with a pure-JS IPPE solver, built once.
  const defaultSolver = new PlanarPnpSquare();
  const solvePose: DemoSolvePose =
    deps.solvePose ??
    ((input) => solveQrPose({ ...input, solver: defaultSolver }));
  let status: DemoStatus = "idle";

  function setStatus(next: DemoStatus): void {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  }

  async function runDetect(image: RgbaImage): Promise<DemoLockResult | null> {
    if (status === "idle") setStatus("scanning");

    const detection = await detect(image);
    if (!detection) return null;

    // Guard the same failure modes the framework's `solveQrPose` rejects:
    // a mirrored winding or a degenerate (tiny / collinear) quad. This keeps
    // the demo's rigid-fit path consistent with the PnP path and prevents an
    // inside-out basis from a bad read. (It does NOT reorder corners — the
    // detector's order carries the QR's reading orientation; see the
    // on-device follow-up §2.3.)
    if (!validateQuad(detection.corners).ok) return null;

    const ctx = getDepthContext();
    if (!ctx) return null; // no depth → cannot size (auto-size gate)

    // Measure size from depth (folds into the per-marker accumulator). `null`
    // means depth couldn't be sampled even after the corner-inset fallback.
    const measurement = measurer.measure(
      detection.text,
      detection.corners,
      image,
      ctx,
    );
    if (!measurement) return null;

    const estimate = measurement.estimate;
    // Relaxed "size exists" gate: place as soon as ANY size is measured (the
    // lever that actually glued on-device). The strict `estimated` lifecycle is
    // only the production GPS-vote gate, not the demo overlay.
    const sizeM = estimate.estimateM;
    if (sizeM === null) return null;

    // Full PnP pose (position AND rotation) from the detected corner pixels.
    // Intrinsics come from the detector buffer's projection (same buffer the
    // corners are in — the #1 PnP correctness risk).
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
    if (!solution) return null;

    const event: QrDetectionEvent = {
      text: detection.text,
      qrPoseWorld: solution.qrPoseWorld,
      qrPoseInCamera: solution.qrPoseInCamera,
      reprojectionErrorPx: solution.reprojectionErrorPx,
      timestamp: timestampNow(),
      // The RAW facts behind the solve. Required rather than optional, so a
      // consumer that needs a raw record alongside the pose gets it from the
      // SAME decode — every producer of this event has them in hand here.
      corners: detection.corners,
      cameraPose: ctx.cameraPose,
      imageWidth: image.width,
      imageHeight: image.height,
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
        recordSize(result.event.text, result.estimate);
        // Render the windowed stable pose when available (smooth overlay); fall
        // back to the raw frame pose while the window is still converging.
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
      setStatus("idle");
    },
  };
}
