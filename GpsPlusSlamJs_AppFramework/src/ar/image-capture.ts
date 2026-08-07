/**
 * Image Capture Module
 *
 * Captures periodic JPEG screenshots from the WebGL canvas during AR recording.
 * Uses async toBlob() for better performance (non-blocking).
 *
 * Includes validation to detect suspiciously small images (likely black/empty)
 * which can occur on mobile devices when the WebGL context hasn't composited yet.
 */

import { createLogger } from '../utils/logger';
import type { ARPose, WebXRVec3, WebXRQuaternion } from '../types/ar-types';
import { angularVelocity, linearVelocity } from './pose-motion';
import {
  decideCapture,
  MotionWindow,
  DEFAULT_MOTION_FILTER,
  type MotionFilterConfig,
} from './capture-motion-gate';
import {
  DEFAULT_QUALITY_FILTER,
  type QualityFilterConfig,
} from './image-quality';

const log = createLogger('ImageCapture');

/**
 * Minimum expected blob size in bytes for a valid JPEG image.
 * A black/empty 1920x1080 JPEG still compresses to ~2-3KB due to headers.
 * A real camera frame at 0.7 quality should be 50KB+.
 * We use a conservative threshold to catch obviously broken captures.
 */
export const MIN_VALID_IMAGE_BYTES = 5000;

/**
 * Configuration for image capture timing and quality
 */
export interface ImageCaptureConfig {
  /** Minimum interval between captures in milliseconds (default: 2000) */
  intervalMs: number;
  /** JPEG quality 0.0-1.0 (default: 0.7) */
  quality: number;
  /** Safety timeout for captureInProgress flag in milliseconds (default: 5000).
   *  If a capture promise doesn't resolve within this duration, the flag is
   *  force-reset to prevent permanent pipeline deadlock. */
  captureTimeoutMs: number;
  /** Resolution divisor for the captured frame: 1 = full native resolution,
   *  2 = half, 4 = quarter (default: 1). Consumed by the blit pipeline in
   *  `startImageCapture`, not by ImageCaptureManager's timing loop. Folded
   *  into this config so the whole user options section can flow through the
   *  capture seam as one object (see the field-drop audit, F3). */
  resolutionDivisor: number;
  /** Motion gate: skip motion-blurred frames by deferring a due capture until
   *  device motion settles (or `maxWaitMs` elapses). Mirrored in the persisted
   *  `ImageCaptureOptions.motionFilter` and flowed through the same capture
   *  seam as `resolutionDivisor`. See `capture-motion-gate.ts`. */
  motionFilter: MotionFilterConfig;
  /** Image-quality gate: drop a blurry/black frame (judged off-thread by the
   *  injected `analyzeFrame` callback) and retry the next acceptable frame,
   *  bounded by `maxWaitMs`. The increment ON TOP of the motion gate — only ever
   *  runs on frames that already passed motion gating. Mirrored in the persisted
   *  `ImageCaptureOptions.qualityFilter`. See `image-quality.ts`. */
  qualityFilter: QualityFilterConfig;
}

/**
 * Default capture configuration
 */
export const DEFAULT_CAPTURE_CONFIG: ImageCaptureConfig = {
  intervalMs: 2000,
  quality: 0.7,
  captureTimeoutMs: 5000,
  resolutionDivisor: 1,
  motionFilter: DEFAULT_MOTION_FILTER,
  qualityFilter: DEFAULT_QUALITY_FILTER,
};

/**
 * Data returned when an image is captured.
 *
 * NOTE: every persistable field here is forwarded into the `add2dImage`
 * action by the RecorderApp's `handleImageCaptured`, which rebuilds the
 * payload field-by-field. A new field added here is therefore NOT persisted
 * until it is threaded through that handler — see
 * `2026-06-12-1130-payload-rebuild-field-drop-audit.md` (F1/F2) and the forwarding
 * test in `main.occupancy-cubes-wiring.test.ts`.
 */
export interface CapturedImage {
  /** The captured image as a Blob */
  readonly blob: Blob;
  /** Epoch milliseconds when captured */
  readonly timestamp: number;
  /** Frame index (0-based, increments each capture) */
  readonly frameIndex: number;
  /** Camera position when captured */
  readonly position: WebXRVec3;
  /** Camera rotation when captured */
  readonly rotation: WebXRQuaternion;
  /** Device screen orientation (0, 90, 180, 270) */
  readonly screenRotation: number;
  /**
   * Width of the encoded JPEG in pixels — the blit/canvas dimensions the blob
   * was produced from, so it equals the decoded image's width. Persisted as
   * `ArImageCapture.width` so consumers (the 3D frame-tile visualizer) can
   * render each frame at its true aspect ratio. Always present from the
   * capture pipeline; optional so the field can be threaded without forcing
   * every test/caller to supply it.
   */
  readonly width?: number;
  /** Height of the encoded JPEG in pixels. See {@link CapturedImage.width}. */
  readonly height?: number;
}

/**
 * A captured frame blob together with the pixel dimensions it was encoded at.
 * Returned by the optional `captureFrame` (blit) callback so the pose-invariant
 * image size can be persisted as first-class metadata (frame-tile aspect-ratio
 * fix, D1 of 2026-06-13-1311-frame-tile-rendering-bugs-user-feedback.md). The
 * dimensions are the blit render-target size — identical to the JPEG's own
 * width/height — so no decode is needed to learn the aspect ratio.
 */
export interface CapturedFrame {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

/**
 * Verdict returned by the injected off-thread {@link ImageCaptureCallbacks.analyzeFrame}
 * analyzer. The manager only needs `accept`; `reason` is carried for logging/
 * tuning. Structurally compatible with `image-quality.ts`'s `QualityVerdict`, so
 * the recorder worker can return that type directly.
 */
export interface FrameQualityVerdict {
  /** `true` to save the frame, `false` to drop it and retry. */
  readonly accept: boolean;
  /** Optional debug reason (e.g. `'black'` | `'blurry'`); for logging only. */
  readonly reason?: string | null;
}

/**
 * Callbacks for image capture integration
 */
export interface ImageCaptureCallbacks {
  /** Get current AR pose (position + orientation) */
  getCurrentPose: () => ARPose | null;
  /** Get device screen rotation (0, 90, 180, 270) */
  getScreenRotation: () => number;
  /** Called when an image is successfully captured */
  onCaptured: (image: CapturedImage) => void;
  /** Called when image capture fails (e.g., toBlob returns null on low memory) */
  onCaptureFailed?: () => void;
  /**
   * Called when a captured image appears suspicious (likely black/empty).
   * This can happen on mobile devices when WebGL hasn't composited the frame yet.
   * The image is still saved (for debugging) but this callback allows logging.
   */
  onSuspiciousImage?: (blobSize: number, frameIndex: number) => void;
  /**
   * Optional custom frame capture function.
   * When provided, this is used instead of canvas.toBlob() for capturing frames.
   * This enables the "blit" technique for WebXR opaque textures that cannot
   * be read directly via canvas.toBlob() (which returns black pixels).
   *
   * @param quality - JPEG quality 0.0-1.0
   * @returns Promise resolving to the JPEG blob plus the pixel dimensions it
   *   was encoded at, or null if capture fails. The dimensions flow into the
   *   persisted `ArImageCapture.width`/`height` for aspect-correct rendering.
   * @see gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-02-06-bug-camera-frames-black.md
   */
  captureFrame?: (quality: number) => Promise<CapturedFrame | null>;
  /**
   * Optional off-thread image-quality analyzer (blur/blackness gate). When
   * provided AND `config.qualityFilter.enabled`, a freshly-encoded blob is NOT
   * saved immediately: it is handed to this async callback (a Web Worker
   * round-trip in the recorder) and saved only if the verdict accepts. A reject
   * drops the blob and re-arms capture so the next acceptable (motion-calm)
   * frame fills the slot, bounded by `qualityFilter.maxWaitMs` (after which the
   * next frame is saved regardless, so an interval is never silently lost).
   *
   * The manager itself NEVER touches pixels — the off-main-thread guarantee. The
   * callback MUST settle its promise; if it rejects, or does not settle within
   * `captureTimeoutMs`, the manager fails open (saves the frame) so a hung
   * analyzer cannot deadlock the pipeline. See `image-quality.ts` and
   * `GpsPlusSlamJs_Docs/docs/2026-06-24-1057-image-quality-gate-plan.md`.
   */
  analyzeFrame?: (frame: CapturedFrame) => Promise<FrameQualityVerdict>;
}

/**
 * Manages periodic image capture from a canvas.
 *
 * Usage:
 * 1. Create with canvas and callbacks
 * 2. Call start() when recording begins
 * 3. Call onFrame(time) each XR frame
 * 4. Call stop() when recording ends
 */
export class ImageCaptureManager {
  private canvas: HTMLCanvasElement;
  private callbacks: ImageCaptureCallbacks;
  private config: ImageCaptureConfig;

  private capturing = false;
  private lastCaptureTime = 0;
  private frameCount = 0;
  private captureInProgress = false;
  private captureTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // --- Image-quality gate state (see image-quality.ts) ---
  /** True while an `analyzeFrame` verdict is in flight; blocks a second capture
   *  for the same interval without throttling normal cadence (captureInProgress
   *  is released after encode, NOT held across the round-trip). */
  private awaitingVerdict = false;
  /** The current interval's capture was rejected by the quality gate; bypass the
   *  interval guard so the next acceptable frame is grabbed immediately. */
  private retryPending = false;
  /** Frame time (ms) of the FIRST quality attempt for the current interval; the
   *  quality `maxWaitMs` fallback measures from here, independent of the motion
   *  gate's own due clock. `null` between intervals. */
  private qualityDeadlineBase: number | null = null;
  /** Safety timeout for a hung `analyzeFrame` (fail-open). */
  private verdictTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // --- Motion-gate state (see capture-motion-gate.ts) ---
  /** Sliding window of recent per-frame velocities for the motion gate. */
  private readonly motionWindow = new MotionWindow();
  /** Previous frame's pose, for the per-frame velocity delta. */
  private prevPose: ARPose | null = null;
  /** Previous frame's timestamp (ms), for the per-frame velocity delta. */
  private prevTime = 0;
  /** Whether THIS frame's velocity sample was rejected as a tracking glitch. */
  private lastSampleWasGlitch = false;
  /** When the current capture first became due (ms); null while not due. The
   *  `maxWaitMs` fallback measures from here, not from `lastCaptureTime`. */
  private dueTime: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    callbacks: ImageCaptureCallbacks,
    config: ImageCaptureConfig = DEFAULT_CAPTURE_CONFIG
  ) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.config = config;
  }

  /**
   * Start capturing images.
   * Resets frame counter and last capture time.
   */
  start(): void {
    this.capturing = true;
    this.lastCaptureTime = 0;
    this.frameCount = 0;
    // Reset motion-gate state so a new session never inherits stale poses.
    this.motionWindow.reset();
    this.prevPose = null;
    this.prevTime = 0;
    this.lastSampleWasGlitch = false;
    this.dueTime = null;
    // Reset image-quality-gate state.
    this.clearVerdictTimeout();
    this.awaitingVerdict = false;
    this.retryPending = false;
    this.qualityDeadlineBase = null;
  }

  /**
   * Stop capturing images.
   * Clears any pending safety timeout and resets in-flight capture state.
   */
  stop(): void {
    this.capturing = false;
    this.clearCaptureTimeout();
    this.captureInProgress = false;
    // Tear down the quality-gate in-flight state so a stopped session can't
    // resolve a stale verdict into a save.
    this.clearVerdictTimeout();
    this.awaitingVerdict = false;
    this.retryPending = false;
    this.qualityDeadlineBase = null;
  }

  /**
   * Check if capture manager is active.
   */
  isCapturing(): boolean {
    return this.capturing;
  }

  /**
   * Get the current frame count.
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * Called each XR frame to check if a capture is needed.
   *
   * @param time - Frame timestamp in milliseconds (from requestAnimationFrame)
   */
  onFrame(time: number): void {
    if (!this.capturing) {
      return;
    }

    // Per-frame motion sampling MUST run above the in-progress / interval
    // guards so the motion gate judges INSTANTANEOUS motion (~one frame) at the
    // decision frame, not a multi-second straight-line average (which nets to
    // ≈0 for in-place shake and lets blur through — plan §4.3).
    // getCurrentPose() is a trivial field read, so sampling every frame is free.
    const pose = this.callbacks.getCurrentPose();
    this.updateMotionWindow(time, pose);

    // Block a new capture while a readback OR a quality verdict is in flight, so
    // only one frame per interval is ever in the pipeline. awaitingVerdict (not
    // captureInProgress) covers the async analysis, so normal cadence is not
    // throttled to the worker round-trip (plan §6).
    if (this.captureInProgress || this.awaitingVerdict) {
      return;
    }

    // Check if enough time has passed since last capture. A pending quality retry
    // bypasses the interval guard so the next acceptable frame fills the slot
    // immediately, rather than waiting a full interval (plan §6 "re-arm").
    const elapsed = time - this.lastCaptureTime;
    if (
      !this.retryPending &&
      this.lastCaptureTime > 0 &&
      elapsed < this.config.intervalMs
    ) {
      this.dueTime = null; // not due yet — reset the fallback clock
      return;
    }

    // Get current pose - skip if not available
    if (!pose) {
      return;
    }

    // A capture is now due. Record WHEN it first became due so the never-calm
    // maxWaitMs fallback measures from the due time, not from lastCaptureTime.
    if (this.dueTime === null) {
      this.dueTime = time;
    }

    // Motion gate: defer the due capture while the device is moving too fast.
    if (!this.shouldCaptureNow(time)) {
      return;
    }

    // Mark capture in progress (prevents overlapping captures). lastCaptureTime
    // is set to the ACTUAL capture time so subsequent intervals are measured
    // from real captures (avoids bunching after a long deferral — plan §4.5).
    this.captureInProgress = true;
    this.lastCaptureTime = time;
    this.dueTime = null;

    // Derive the timestamp from the XR frame time (a DOMHighResTimeStamp) so it
    // shares the exact epoch-ms time domain as the AR pose and the other
    // per-frame streams (e.g. depth samples also use performance.timeOrigin +
    // time). Using Date.now() here would introduce sub-frame drift and break
    // precise alignment between the image and its same-frame pose.
    const timestamp = performance.timeOrigin + time;
    const screenRotation = this.callbacks.getScreenRotation();
    // The frame index is allocated only when a frame is actually SAVED (in
    // saveCapture), not here — so a frame dropped+retried by the quality gate
    // never burns an index and leaves a gap in the frame-NNNNNN.jpg sequence.

    // Start safety timeout to prevent permanent captureInProgress deadlock.
    // If the capture promise never resolves (e.g., canvas.toBlob callback dropped
    // by XR compositor), this resets the flag after captureTimeoutMs.
    this.captureTimeoutId = setTimeout(() => {
      if (this.captureInProgress) {
        log.error(
          `Capture timeout after ${this.config.captureTimeoutMs}ms — force-resetting captureInProgress`
        );
        this.captureInProgress = false;
        this.captureTimeoutId = null;
      }
    }, this.config.captureTimeoutMs);

    // Use custom captureFrame (blit technique) if provided, else fall back to canvas.toBlob
    if (this.callbacks.captureFrame) {
      this.callbacks
        .captureFrame(this.config.quality)
        .then((frame) => {
          this.handleCapturedBlob(
            frame?.blob ?? null,
            frame?.width,
            frame?.height,
            timestamp,
            time,
            pose,
            screenRotation
          );
        })
        .catch(() => {
          this.clearCaptureTimeout();
          this.captureInProgress = false;
          this.callbacks.onCaptureFailed?.();
        });
    } else {
      // Legacy path: capture using async toBlob. The canvas backing-store
      // dimensions are exactly what toBlob encodes, so they are the image's
      // true pixel size.
      this.canvas.toBlob(
        (blob) => {
          this.handleCapturedBlob(
            blob,
            this.canvas.width,
            this.canvas.height,
            timestamp,
            time,
            pose,
            screenRotation
          );
        },
        'image/jpeg',
        this.config.quality
      );
    }
  }

  /**
   * Sample per-frame device motion into the sliding window. Called every frame
   * (even during an in-flight capture or before the interval elapses) so the
   * window reflects truly instantaneous motion the moment a capture becomes
   * due. A frame with no pose, or a non-positive dt (duplicate timestamp),
   * records no sample and is treated as "not a glitch".
   */
  private updateMotionWindow(time: number, pose: ARPose | null): void {
    if (!pose) {
      this.lastSampleWasGlitch = false;
      // Tracking lost: drop the window and the prev-frame baseline. Otherwise
      // the first sample after recovery is computed across the whole outage gap
      // (not instantaneous), and stale pre-loss maxima keep deferring captures
      // after the device has settled. MotionWindow.reset()'s doc designates
      // this exact "on tracking loss" trigger.
      this.motionWindow.reset();
      this.prevPose = null;
      this.prevTime = 0;
      // Also reset the quality-gate retry state. `qualityDeadlineBase` measures
      // the never-good `maxWaitMs` fallback from the FIRST attempt of an interval
      // (cleared only on save). A tracking outage longer than maxWaitMs would
      // otherwise leave it stale, so the first frame after recovery satisfies
      // `time - base >= maxWaitMs` and is saved fail-open WITHOUT analysis — even
      // if blurry/black. Clearing it lets recovery start a fresh quality attempt.
      this.retryPending = false;
      this.qualityDeadlineBase = null;
      return;
    }
    if (this.prevPose && this.prevTime > 0) {
      const dt = (time - this.prevTime) / 1000;
      if (dt > 0) {
        const angVel = angularVelocity(
          this.prevPose.orientation,
          pose.orientation,
          dt
        );
        const linVel = linearVelocity(
          this.prevPose.position,
          pose.position,
          dt
        );
        // push() returns false for a glitch/non-finite sample (not stored).
        this.lastSampleWasGlitch = !this.motionWindow.push(angVel, linVel);
      } else {
        this.lastSampleWasGlitch = false;
      }
    } else {
      this.lastSampleWasGlitch = false;
    }
    this.prevPose = pose;
    this.prevTime = time;
  }

  /**
   * Apply the motion gate to a due capture. Returns `true` to capture now,
   * `false` to defer to a later frame.
   *
   * - Filter disabled → always `true` (legacy behavior).
   * - `maxWaitMs` elapsed → always `true` (never-calm safety fallback; an
   *   interval is never silently lost).
   * - Current frame's sample was a tracking glitch → `false` (don't grab a
   *   relocalization-teleport frame; the fallback still guarantees progress).
   * - No measurable motion yet (first capture / all-glitch) → `true` (the very
   *   first capture is never blocked; only measurable motion defers).
   * - Otherwise → defer to {@link decideCapture} over the windowed maxima.
   */
  private shouldCaptureNow(time: number): boolean {
    const mf = this.config.motionFilter;
    if (!mf || !mf.enabled) {
      return true;
    }
    const msSinceDue = this.dueTime === null ? 0 : time - this.dueTime;
    if (msSinceDue >= mf.maxWaitMs) {
      return true;
    }
    if (this.lastSampleWasGlitch) {
      return false;
    }
    if (!this.motionWindow.hasSamples()) {
      return true;
    }
    return (
      decideCapture({
        windowMaxAngular: this.motionWindow.maxAngular(),
        windowMaxLinear: this.motionWindow.maxLinear(),
        maxAngularVelocity: mf.maxAngularVelocity,
        maxLinearVelocity: mf.maxLinearVelocity,
        msSinceDue,
        maxWaitMs: mf.maxWaitMs,
      }) === 'capture'
    );
  }

  /**
   * Clear the safety timeout for captureInProgress.
   * Called when capture completes (success or failure) before the timeout fires.
   */
  private clearCaptureTimeout(): void {
    if (this.captureTimeoutId !== null) {
      clearTimeout(this.captureTimeoutId);
      this.captureTimeoutId = null;
    }
  }

  /** Clear the safety timeout for a hung `analyzeFrame` verdict. */
  private clearVerdictTimeout(): void {
    if (this.verdictTimeoutId !== null) {
      clearTimeout(this.verdictTimeoutId);
      this.verdictTimeoutId = null;
    }
  }

  /**
   * Common handler for captured blobs (from either canvas.toBlob or captureFrame).
   * Releases `captureInProgress` after the synchronous encode, then either saves
   * immediately (legacy / gate-off) or runs the off-thread image-quality gate.
   *
   * @param time - the XR frame time the capture was dispatched at; the quality
   *   retry-deadline clock and `lastCaptureTime` are measured from it.
   */
  private handleCapturedBlob(
    blob: Blob | null,
    width: number | undefined,
    height: number | undefined,
    timestamp: number,
    time: number,
    pose: ARPose,
    screenRotation: number
  ): void {
    this.clearCaptureTimeout();
    this.captureInProgress = false;

    if (!blob) {
      // Issue #11: Notify caller when capture fails (e.g., low memory)
      this.callbacks.onCaptureFailed?.();
      return;
    }

    const qf = this.config.qualityFilter;
    const analyze = this.callbacks.analyzeFrame;

    // Legacy / gate-off path: no analyzer or the gate is disabled → save now.
    if (!analyze || !qf || !qf.enabled) {
      this.saveCapture(blob, width, height, timestamp, pose, screenRotation);
      return;
    }

    // Quality gate active. Start the retry-deadline clock on the FIRST attempt
    // for this interval (independent of the motion gate's own due clock).
    if (this.qualityDeadlineBase === null) this.qualityDeadlineBase = time;
    if (time - this.qualityDeadlineBase >= qf.maxWaitMs) {
      // Never-good fallback: too long retrying → save regardless (no analysis)
      // so a recording interval is never silently lost.
      this.saveCapture(blob, width, height, timestamp, pose, screenRotation);
      return;
    }

    // Off-thread analysis. captureInProgress is already cleared; awaitingVerdict
    // blocks a second capture for THIS interval until the verdict resolves.
    // `finish` is guarded to run exactly once per attempt, so the safety timeout
    // (fail-open) and the real verdict can never both act.
    this.awaitingVerdict = true;
    let settled = false;
    const finish = (accept: boolean, viaTimeout: boolean): void => {
      // `stop()` cannot reach this per-attempt closure (settled is local), so a
      // verdict still in flight at teardown — including the fail-open resolution
      // `dispose()` triggers on stop — would otherwise run saveCapture →
      // onCaptured on a stopped session, writing a frame after endSession that
      // the recorded frameCount never saw. Drop a late verdict once stopped.
      if (settled || !this.capturing) return;
      settled = true;
      this.clearVerdictTimeout();
      this.awaitingVerdict = false;
      if (viaTimeout) {
        log.error(
          'analyzeFrame verdict timed out — saving frame fail-open to keep the pipeline live'
        );
      }
      if (accept) {
        this.saveCapture(blob, width, height, timestamp, pose, screenRotation);
      } else {
        // Drop + re-arm: the next motion-calm frame fills the slot (retry).
        this.retryPending = true;
      }
    };

    // Defensive: a hung analyzer must not deadlock the pipeline (awaitingVerdict
    // would otherwise block every future capture). Fail open after the same
    // budget the readback uses.
    this.verdictTimeoutId = setTimeout(
      () => finish(true, true),
      this.config.captureTimeoutMs
    );

    analyze({ blob, width: width ?? 0, height: height ?? 0 })
      .then((verdict) => finish(verdict.accept, false))
      .catch((err: unknown) => {
        // Fail-open: a worker/analyzer error must not lose the interval.
        log.error(
          'analyzeFrame failed — saving frame without quality gate',
          err
        );
        finish(true, false);
      });
  }

  /**
   * Persist an accepted frame: allocate its 1-based index, run the suspicious-
   * size belt-and-suspenders check, reset the per-interval gate clocks, and fire
   * `onCaptured`. Called from the legacy path, the quality fallbacks, and an
   * accepting verdict — the single place a frame becomes durable.
   */
  private saveCapture(
    blob: Blob,
    width: number | undefined,
    height: number | undefined,
    timestamp: number,
    pose: ARPose,
    screenRotation: number
  ): void {
    // Single durable-write chokepoint, so guard it once for every path
    // (legacy/gate-off, never-good fallback, AND accepting verdict). A blob
    // whose async encode or off-thread verdict completes after `stop()` must
    // not increment frameCount or fire onCaptured on a torn-down session — the
    // recorded frameCount was already snapshotted at stop. The gate-off path is
    // the common case (quality gate defaults off), so this is the primary guard.
    if (!this.capturing) return;
    // This interval is now satisfied — clear the retry/quality clocks so the next
    // interval starts fresh. (dueTime was already nulled at dispatch.)
    this.retryPending = false;
    this.qualityDeadlineBase = null;

    // 1-based indexing (frame-000001.jpg, …) per opfs-storage.ts.md invariants;
    // allocated here so dropped/retried frames never leave gaps.
    const frameIndex = ++this.frameCount;

    // Check if the blob is suspiciously small (likely black/empty image). The
    // luminance gate supersedes this for correctness, but keep it as a cheap
    // belt-and-suspenders signal on every path (plan §4).
    if (blob.size < MIN_VALID_IMAGE_BYTES) {
      log.error(
        `Suspicious image at frame ${frameIndex}: blob size ${blob.size} bytes ` +
          `is below minimum ${MIN_VALID_IMAGE_BYTES} bytes. Image may be black/empty.`
      );
      this.callbacks.onSuspiciousImage?.(blob.size, frameIndex);
      // Still proceed with saving the image for debugging purposes
    }

    // width/height are the encoded pixel dimensions (blit render target or canvas
    // backing store) — only attached when known/positive so a degenerate 0 never
    // poisons the persisted aspect ratio.
    this.callbacks.onCaptured({
      blob,
      timestamp,
      frameIndex,
      position: pose.position,
      rotation: pose.orientation,
      screenRotation,
      ...(width && width > 0 ? { width } : {}),
      ...(height && height > 0 ? { height } : {}),
    });
  }
}
