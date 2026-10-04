/**
 * Camera frame source — a GENERIC throttled RGBA camera-frame feed for
 * computer-vision consumers (QR detection today; object detection / OpenCV
 * tomorrow). Framework-wiring-options Part A / B2.
 *
 * Mirrors {@link DepthSampler}'s shape: a per-XR-frame `onFrame(timestamp)`
 * tick that, **only when `intervalMs` has elapsed**, performs an injected
 * `capture()` (the GPU blit → top-left RGBA) and hands the result to
 * `onCapture`. Throttling the *capture itself* — not just the downstream detect
 * — is the efficiency win the in-session wiring unlocks (§A.4): on a 60 fps
 * device the blit runs ~8×/s instead of every render frame.
 *
 * **Single cadence owner (Option A).** When a {@link createDetectionScheduler}
 * (QR controller, object detector, …) is driven from this source, the source
 * should be the ONE place that sets the cadence: give it the detection
 * `intervalMs` and set the scheduler's own `minIntervalMs` to `0`. The
 * scheduler's coalescing still prevents overlapping in-flight detects, so every
 * delivered frame is detected without a second throttle dropping boundary
 * frames. (Two equal throttles in series let jitter drop ~1 frame per cycle.)
 *
 * `capture` is injected (not a hard dependency on `CameraBlitCapture` /
 * `WebGLRenderer`) so the throttle is pure-logic unit-testable without a GPU —
 * see `camera-frame-source.test.ts`, which pins the cadence as a performance
 * regression test.
 *
 * SCOPE — single consumer (by design, for now). The session wires exactly ONE
 * `CameraFrameSource` + one callback + one blit (initAR `callbacks.cameraFrame`). One
 * CV consumer at a time (QR *or* object detection) is the only current need.
 * If two live CV consumers must run **simultaneously** (e.g. QR + OpenCV object
 * detection at different cadences/resolutions), DO NOT bolt a second global
 * callback onto the session — generalize to a small **multi-consumer registry**:
 * `registerCameraFrameConsumer({ intervalMs, captureSize, onFrame }) =>
 * unregister`, each consumer getting its own throttle + (shared-where-equal)
 * blit. This class already supports that — it's per-instance and the cadence is
 * per-instance — so the change is in `webxr-session.ts`'s wiring, not here.
 *
 * @see camera-blit-capture.ts — `captureToRgba` (the production `capture`).
 * @see webxr-session.ts — owns the camera-frame blit and wires this in the frame loop.
 */

import type { RgbaImage } from './qr/qr-frontend.js';

/** Tuning for the camera frame source. */
export interface CameraFrameSourceConfig {
  /**
   * Minimum interval between captures in milliseconds. Default 125 ms (≈ 8 Hz),
   * the plan §9 5–10 Hz detection target. The capture (and therefore the blit)
   * fires at most once per `intervalMs`.
   */
  intervalMs: number;
}

/**
 * Injected I/O for the camera frame source. `TFrame` is whatever the capture
 * builds - the session delivers a pose-paired `CapturedCameraFrame`.
 */
export interface CameraFrameSourceCallbacks<TFrame = RgbaImage> {
  /**
   * Capture the current XR frame (given its XR frame `timestamp`), or `null` when no
   * frame is available (no camera texture yet, GL failure). This is the GPU
   * blit + readback; the source only invokes it at the throttled cadence so
   * the cost is bounded. A `null` return does NOT consume the interval slot —
   * the next frame retries immediately (a missing texture is transient).
   */
  capture: (timestamp: number) => TFrame | null;
  /** Receive a throttled, successfully-captured frame. */
  onCapture: (frame: TFrame) => void;
}

const DEFAULT_CONFIG: CameraFrameSourceConfig = {
  intervalMs: 125,
};

/**
 * Throttled RGBA capturer. Construct with the injected `capture`/`onCapture`
 * pair, `start()`, then call `onFrame(timestamp)` once per XR frame.
 */
export class CameraFrameSource<TFrame = RgbaImage> {
  private readonly callbacks: CameraFrameSourceCallbacks<TFrame>;
  private readonly config: CameraFrameSourceConfig;
  private running = false;
  private captureCount = 0;
  private lastCaptureTime = -Infinity;
  private wantsFrame: (() => boolean) | null = null;

  constructor(
    callbacks: CameraFrameSourceCallbacks<TFrame>,
    config?: Partial<CameraFrameSourceConfig>
  ) {
    this.callbacks = callbacks;
    // Route the optional config through updateConfig so the SAME validation
    // applies at construction as at runtime — an invalid intervalMs (≤ 0, NaN,
    // Infinity) must fall back to the default cadence, never bypass the throttle.
    this.config = { ...DEFAULT_CONFIG };
    if (config) {
      this.updateConfig(config);
    }
  }

  /** Begin throttling. Resets the cadence so the first tick captures. */
  start(): void {
    this.running = true;
    this.captureCount = 0;
    this.lastCaptureTime = -Infinity;
  }

  /** Stop capturing. `onFrame` becomes a no-op until `start()` is called again. */
  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Number of frames successfully captured + delivered since `start()`. */
  getFrameCount(): number {
    return this.captureCount;
  }

  getConfig(): CameraFrameSourceConfig {
    return { ...this.config };
  }

  /**
   * Apply partial config (e.g. the app's detection cadence). Invalid values
   * are ignored defensively — `intervalMs` requires a finite positive number.
   */
  updateConfig(config: Partial<CameraFrameSourceConfig>): void {
    if (
      typeof config.intervalMs === 'number' &&
      Number.isFinite(config.intervalMs) &&
      config.intervalMs > 0
    ) {
      this.config.intervalMs = config.intervalMs;
    }
  }

  /**
   * Let the consumer veto captures it cannot use (e.g. while its detector is
   * still busy with the previous frame). A veto skips the blit + readback
   * without consuming the interval, so the first frame after the veto lifts is
   * captured at once. `null` restores "always wanted".
   */
  setWantsFrame(wantsFrame: (() => boolean) | null): void {
    this.wantsFrame = wantsFrame;
  }

  /**
   * Per-XR-frame tick. Captures + delivers a frame at most once per
   * `intervalMs`; otherwise a cheap no-op so it is safe to call every frame.
   *
   * @param timestamp - monotonic frame time in ms (the XR `time` argument).
   */
  onFrame(timestamp: number): void {
    if (!this.running) {
      return;
    }
    if (timestamp - this.lastCaptureTime < this.config.intervalMs) {
      return;
    }
    if (!this.consumerWantsFrame()) {
      return; // slot NOT consumed: retry on the next frame
    }

    // Interval elapsed — do the (expensive) capture now. A null result is a
    // transient missing-texture; do NOT consume the slot so the next frame
    // retries rather than waiting another full interval.
    const image = this.captureSafely(timestamp);
    if (!image) {
      return;
    }

    this.lastCaptureTime = timestamp;
    this.captureCount++;
    this.callbacks.onCapture(image);
  }

  /** The consumer's veto; a throwing predicate counts as "wanted". */
  private consumerWantsFrame(): boolean {
    if (!this.wantsFrame) return true;
    try {
      return this.wantsFrame();
    } catch {
      return true;
    }
  }

  /**
   * Run the injected capture, guarded so a blit failure (e.g. GL context loss)
   * can never throw out of the XR frame loop — it degrades to "no frame this
   * tick", exactly like a missing texture.
   */
  private captureSafely(timestamp: number): TFrame | null {
    try {
      return this.callbacks.capture(timestamp);
    } catch {
      return null;
    }
  }
}
