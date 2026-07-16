/**
 * Depth Sampler
 *
 * Samples sparse depth points from WebXR depth sensing API.
 * Depth data provides 3D point samples for reconstruction and validation.
 *
 * @see depth-sampler.md for detailed documentation
 */

import type { Matrix4 } from 'gps-plus-slam-js';
import type { ARPose, DepthPoint, DepthSample } from '../types/ar-types';
import type { RgbLookup } from './depth-rgb-lookup';
import { extractOdomPosition } from '../types/ar-types';

export type { DepthSample } from '../types/ar-types';

/**
 * Configuration for depth sampling behavior.
 */
export interface DepthSamplerConfig {
  /** Interval between samples in milliseconds. Default: 1000ms */
  intervalMs: number;
  /**
   * Number of points per dimension (gridSize x gridSize). Default: 16
   * (256 pts at 1 Hz — dense enough to populate the AR-space occupancy
   * grid for on-device verification, see the 2026-06-11 port plan §1).
   */
  gridSize: number;
  /** Time in ms to wait before declaring depth unavailable. Default: 5000ms */
  unavailabilityThresholdMs: number;
  /**
   * Whether to enrich each sampled point with the camera color at its view
   * coordinates (occupancy-grid port plan Iter 8). Requires the
   * `acquireRgbLookup` callback; gates the per-sample GPU blit+readback.
   * Default: true.
   */
  rgb: boolean;
}

/**
 * Callbacks for depth sampler events.
 */
export interface DepthSamplerCallbacks {
  /** Called when a depth sample is captured */
  onSampleCaptured: (sample: DepthSample) => void;
  /** Returns the current AR pose, or null if not available */
  getCurrentPose: () => ARPose | null;
  /**
   * Called once when depth is determined to be unavailable.
   * Triggered after unavailabilityThresholdMs with no depth data.
   * Field Test Readiness Issue #8.
   */
  onDepthUnavailable?: () => void;
  /**
   * Lazily acquire a camera-color lookup for the CURRENT XR frame
   * (occupancy-grid port plan Iter 8). Invoked at most once per *emitted*
   * sample (never per frame or per point — acquisition is a GPU-stall
   * blit+readback) and only while `config.rgb` is true. Returning `null`
   * (or throwing) yields color-less points; the returned lookup is used
   * synchronously within the same frame callback.
   */
  acquireRgbLookup?: () => RgbLookup | null;
}

/**
 * WebXR depth info interface (subset of XRDepthInformation), extended with
 * the capturing view's projection matrix so each emitted DepthSample carries
 * the intrinsics needed for unprojection. Build via {@link wrapXRDepthInfo}.
 */
export interface DepthInfo {
  width: number;
  height: number;
  getDepthInMeters: (x: number, y: number) => number;
  /** Column-major projection matrix of the capturing XRView, if known. */
  projectionMatrix?: Matrix4;
  /**
   * Raw depth buffer (`XRCPUDepthInformation.data`) — a **live reference**
   * valid only within the originating XR frame callback (NOT copied, unlike
   * the matrices: the per-frame buffer is too large to clone and the live
   * depth occluder uploads it synchronously). Absent when the source carries
   * no `data` (e.g. the sparse-only path). Plumbed for the live depth occluder
   * (2026-06-14-0009-webxr-depth-occlusion-plan.md §2); the sparse sampler ignores it.
   */
  data?: ArrayBuffer;
  /**
   * `XRCPUDepthInformation.rawValueToMeters` — multiply a raw depth sample by
   * this to get metres. Preserved only when a finite number. Occluder-only.
   */
  rawValueToMeters?: number;
  /**
   * The `.matrix` (column-major 16-tuple) of
   * `XRDepthInformation.normDepthBufferFromNormView` — the screen-UV → depth-UV
   * transform the occluder shader needs. Copied + validated like
   * `projectionMatrix` (the UA may reuse the backing array). Occluder-only.
   */
  normDepthBufferFromNormView?: Matrix4;
}

/**
 * Defensively copy a 16-element column-major matrix into a plain serializable
 * tuple. Returns undefined for missing input, the wrong length, or any
 * non-finite entry — so an invalid (or UA-reused/garbage) source degrades to
 * "absent" rather than poisoning downstream maths. The copy also de-aliases
 * Float32Arrays the UA reuses across frames.
 */
function copyValidMatrix16(
  src: ArrayLike<number> | null | undefined
): Matrix4 | undefined {
  if (!src || src.length !== 16) {
    return undefined;
  }
  const copy = Array.from(src);
  return copy.every((v) => Number.isFinite(v))
    ? (copy as unknown as Matrix4)
    : undefined;
}

/**
 * Wrap a raw browser XRDepthInformation object into a {@link DepthInfo}.
 *
 * - `getDepthInMeters` is bound to the source object (browser
 *   implementations are this-sensitive).
 * - `projectionMatrix` (typically `XRView.projectionMatrix`, a Float32Array
 *   the UA may reuse across frames) is defensively validated and copied into
 *   a plain serializable 16-tuple; invalid input (wrong length, non-finite
 *   entries) yields a DepthInfo without a matrix rather than an error.
 * - The live-occluder metadata (`data`, `rawValueToMeters`,
 *   `normDepthBufferFromNormView`) is preserved when present and valid: `data`
 *   by live reference (no clone — see {@link DepthInfo.data}), the scale only
 *   when finite, and the UV transform's `.matrix` copied like
 *   `projectionMatrix`. The sparse grid sampler ignores all three; a source
 *   lacking them (e.g. the existing test doubles) wraps exactly as before.
 */
export function wrapXRDepthInfo(
  raw: {
    width: number;
    height: number;
    getDepthInMeters: (x: number, y: number) => number;
    data?: ArrayBuffer;
    rawValueToMeters?: number;
    normDepthBufferFromNormView?: { matrix?: ArrayLike<number> } | null;
  },
  projectionMatrix: ArrayLike<number> | undefined
): DepthInfo {
  const wrapped: DepthInfo = {
    width: raw.width,
    height: raw.height,
    getDepthInMeters: raw.getDepthInMeters.bind(raw),
  };
  const projection = copyValidMatrix16(projectionMatrix);
  if (projection) {
    wrapped.projectionMatrix = projection;
  }
  // Live reference, not a clone — the per-frame buffer is large and the
  // occluder uploads it synchronously within this frame callback.
  if (raw.data instanceof ArrayBuffer) {
    wrapped.data = raw.data;
  }
  if (
    typeof raw.rawValueToMeters === 'number' &&
    Number.isFinite(raw.rawValueToMeters)
  ) {
    wrapped.rawValueToMeters = raw.rawValueToMeters;
  }
  const uvTransform = copyValidMatrix16(
    raw.normDepthBufferFromNormView?.matrix
  );
  if (uvTransform) {
    wrapped.normDepthBufferFromNormView = uvTransform;
  }
  return wrapped;
}

/**
 * Recommended depth-sampling cadence for apps that RECONSTRUCT-and-render an
 * occupancy mesh (the Recorder, the PhysicsDemo) — the depth-side counterpart
 * of `DEFAULT_OCCUPANCY_CELL_SIZE_M`/`DEFAULT_OCCUPANCY_MIN_OBSERVATIONS`
 * (occupancy-grid.ts): one framework-level source of truth so both apps build
 * the mesh at the same speed. Hoisted 2026-07-16 after field feedback that
 * the demo (which relied on the conservative library fallback below: 16×16 @
 * 1 Hz ≈ 256 points/s) reconstructed visibly slower than the recorder
 * (32×32 @ 2 Hz ≈ 2048 points/s — 8×). Deliberately OPT-IN named constants,
 * NOT a change to the fallback: bumping the fallback would silently re-tune
 * consumers that are not reconstruction apps (MinimalExample / AnchorStarter).
 */
export const DEFAULT_RECONSTRUCTION_DEPTH_INTERVAL_MS = 500;
export const DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE = 32;

// Library-level fallback used by consumers that do NOT supply a config
// (MinimalExample / AnchorStarter). Intentionally NOT synced to the
// reconstruction constants above — bumping this default would silently
// re-tune unrelated apps. See the recorder's recording-options.ts.md (F1)
// for the tuning history (the catalog moved app-side on 2026-07-11:
// GpsPlusSlamJs_RecorderApp/src/state/).
const DEFAULT_CONFIG: DepthSamplerConfig = {
  intervalMs: 1000,
  gridSize: 16,
  unavailabilityThresholdMs: 5000,
  rgb: true,
};

/**
 * Samples sparse depth points from WebXR depth sensing.
 *
 * Usage:
 * ```ts
 * const sampler = new DepthSampler({
 *   onSampleCaptured: (sample) => saveSample(sample),
 *   getCurrentPose: () => arSession.getCurrentPose(),
 * });
 * sampler.start();
 * // In frame loop:
 * sampler.onFrame(timestamp, depthInfo);
 * ```
 */
export class DepthSampler {
  private readonly callbacks: DepthSamplerCallbacks;
  private readonly config: DepthSamplerConfig;
  private running = false;
  private sampleCount = 0;
  private lastSampleTime = -Infinity;
  /** Timestamp when sampling started (for unavailability detection) */
  private startTime = -Infinity;
  /** Whether we've ever received valid depth data */
  private depthReceived = false;
  /** Whether we've already fired the unavailable callback */
  private unavailableCallbackFired = false;

  constructor(
    callbacks: DepthSamplerCallbacks,
    config?: Partial<DepthSamplerConfig>
  ) {
    this.callbacks = callbacks;
    // Route the initial config through the same validation as updateConfig so
    // the constructor cannot seat values updateConfig itself would refuse (a
    // fractional gridSize, a non-finite/non-positive intervalMs that would
    // disable the throttle). Mirrors the camera-frame-source fix (PR #91).
    this.config = { ...DEFAULT_CONFIG };
    if (config) {
      this.updateConfig(config);
    }
  }

  /**
   * Start depth sampling.
   */
  start(): void {
    this.running = true;
    this.sampleCount = 0;
    this.lastSampleTime = -Infinity;
    this.startTime = performance.now();
    this.depthReceived = false;
    this.unavailableCallbackFired = false;
  }

  /**
   * Stop depth sampling.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Check if sampler is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the number of samples captured since start.
   */
  getSampleCount(): number {
    return this.sampleCount;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): DepthSamplerConfig {
    return { ...this.config };
  }

  /**
   * Apply partial configuration overrides (e.g. the user's recording
   * options, plumbed in by `startDepthCapture` just before sampling
   * starts). Invalid values are ignored defensively: every key requires a
   * finite positive number, and `gridSize` additionally an integer.
   */
  updateConfig(config: Partial<DepthSamplerConfig>): void {
    if (isFinitePositive(config.intervalMs)) {
      this.config.intervalMs = config.intervalMs;
    }
    if (
      isFinitePositive(config.gridSize) &&
      Number.isInteger(config.gridSize)
    ) {
      this.config.gridSize = config.gridSize;
    }
    if (isFinitePositive(config.unavailabilityThresholdMs)) {
      this.config.unavailabilityThresholdMs = config.unavailabilityThresholdMs;
    }
    if (typeof config.rgb === 'boolean') {
      this.config.rgb = config.rgb;
    }
  }

  /**
   * Called each frame with a LAZY depth provider (quality-review E-4: the
   * caller used to acquire + wrap the depth info every frame while this
   * method threw ~59 of 60 acquisitions away at the interval check — the
   * provider is now invoked only when a sample is due).
   *
   * Unavailability detection is preserved by construction:
   * `lastSampleTime` only advances when a sample is EMITTED, so while depth
   * is unavailable the sampler stays "due" and probes the provider every
   * frame — exactly the cadence the old per-frame acquisition gave
   * `checkDepthUnavailability` (Field Test Readiness Issue #8).
   *
   * @param timestamp - Current frame timestamp in milliseconds
   * @param acquireDepthInfo - Returns the frame's depth info, or null if
   *   unavailable. Only invoked when a sample is due.
   */
  onFrame(timestamp: number, acquireDepthInfo: () => DepthInfo | null): void {
    if (!this.running) {
      return;
    }

    // Interval gate FIRST — skip the acquisition entirely between samples.
    if (timestamp - this.lastSampleTime < this.config.intervalMs) {
      return;
    }

    const depthInfo = acquireDepthInfo();
    if (!depthInfo) {
      // Check if we should fire the unavailable callback
      // (Field Test Readiness Issue #8: Depth sensing not confirmed)
      this.checkDepthUnavailability();
      return;
    }

    // Mark that we've received depth data
    this.depthReceived = true;

    // Get current pose
    const pose = this.callbacks.getCurrentPose();
    if (!pose) {
      return;
    }

    // Sample the grid, optionally enriched with the camera color at each
    // point (acquired at most once per emitted sample — see the callback's
    // contract; failures degrade to color-less points).
    const points = this.sampleGrid(depthInfo, this.acquireRgbLookupSafely());

    // Create sample — convert DOMHighResTimeStamp to epoch ms for consistency
    // with all other action timestamps (GPS events, images, reference points)
    const sample: DepthSample = {
      timestamp: performance.timeOrigin + timestamp,
      cameraPos: extractOdomPosition(pose),
      cameraRot: [
        pose.orientation.x,
        pose.orientation.y,
        pose.orientation.z,
        pose.orientation.w,
      ],
      points,
      // Spread keeps the field absent (not `undefined`) when the depth info
      // carries no matrix, so persisted JSON stays identical to old format
      ...(depthInfo.projectionMatrix
        ? { projectionMatrix: depthInfo.projectionMatrix }
        : {}),
    };

    this.lastSampleTime = timestamp;
    this.sampleCount++;
    this.callbacks.onSampleCaptured(sample);
  }

  /**
   * Acquire the per-sample RGB lookup, gated by `config.rgb` and guarded so
   * a failing acquisition (e.g. GL context loss during the blit) can never
   * break the sample emission in the XR frame loop.
   */
  private acquireRgbLookupSafely(): RgbLookup | null {
    if (!this.config.rgb || !this.callbacks.acquireRgbLookup) {
      return null;
    }
    try {
      return this.callbacks.acquireRgbLookup();
    } catch {
      return null;
    }
  }

  /**
   * Sample a grid of depth points from the depth buffer, attaching the
   * camera color per point when a lookup is available.
   */
  private sampleGrid(
    depthInfo: DepthInfo,
    rgbLookup: RgbLookup | null
  ): DepthPoint[] {
    const points: DepthPoint[] = [];
    const gridSize = this.config.gridSize;

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        // Calculate normalized screen coordinates (avoiding edges)
        // For a 3x3 grid: positions at 0.25, 0.5, 0.75
        const screenX = (col + 1) / (gridSize + 1);
        const screenY = (row + 1) / (gridSize + 1);

        // Sample depth at this position
        const depthM = depthInfo.getDepthInMeters(screenX, screenY);

        // Spread keeps `rgb` ABSENT (not `undefined`) when there is no
        // color, so persisted JSON stays identical to the pre-Iter-8 format
        const rgb = rgbLookup?.(screenX, screenY);
        points.push({
          screenX,
          screenY,
          depthM,
          ...(rgb ? { rgb } : {}),
        });
      }
    }

    return points;
  }

  /**
   * Check if depth has been unavailable for longer than the threshold.
   * If so, fire the onDepthUnavailable callback (once).
   */
  private checkDepthUnavailability(): void {
    // Don't check if we've already received depth or fired callback
    if (this.depthReceived || this.unavailableCallbackFired) {
      return;
    }

    // Don't fire if no callback is registered
    if (!this.callbacks.onDepthUnavailable) {
      return;
    }

    // Check elapsed time since start
    const elapsed = performance.now() - this.startTime;
    if (elapsed >= this.config.unavailabilityThresholdMs) {
      this.unavailableCallbackFired = true;
      this.callbacks.onDepthUnavailable();
    }
  }

  /**
   * Check if depth data has ever been received.
   * Useful for testing and status display.
   */
  hasReceivedDepth(): boolean {
    return this.depthReceived;
  }
}

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
