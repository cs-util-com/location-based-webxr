/**
 * Capture motion gate — the policy that decides whether a *due* capture should
 * fire on the current frame or be deferred until the device settles.
 *
 * Two cohesive pieces, both pure/deterministic and unit-testable in isolation
 * from `ImageCaptureManager`:
 *  - {@link decideCapture} — the stateless capture-vs-defer decision over the
 *    windowed motion maxima, the thresholds, and the time since the capture
 *    became due (the never-calm safety fallback).
 *  - {@link MotionWindow} — a tiny fixed-size ring of recent per-frame
 *    velocities with glitch rejection, so the decision judges "max over the
 *    last N frames" rather than one lucky-calm sample.
 *
 * The window size and glitch ceilings are INTERNAL constants, deliberately not
 * user-facing config: the user-facing surface is only enabled / maxAngular /
 * maxLinear / maxWaitMs (plan §5.1). Keeping the stateful policy here (not in a
 * speculative framework-wide service) matches the plan's §4.1 scope note.
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-06-23-2105-blurry-frame-motion-gating-plan.md §4.2-4.4
 */

import { validateOptionFields } from '../utils/validate-option-fields.js';

/** Default number of recent frames the gate judges motion over (~50 ms @ 60fps). */
export const DEFAULT_MOTION_WINDOW_SIZE = 3;

/**
 * Angular velocity (rad/s) above which a sample is treated as a tracking glitch
 * (e.g. relocalization teleport), not real motion. A genuine hand/device turn
 * tops out well below this; a teleport is far above it. Module-internal tuning
 * constant (not exported — the gate's user surface is only the four
 * `MotionFilterConfig` fields); overridable per-instance via the `MotionWindow`
 * constructor for tests.
 */
const ANGULAR_GLITCH_CEILING_RAD_S = 50;

/**
 * Linear velocity (m/s) above which a sample is treated as a tracking glitch.
 * ~20 m/s (72 km/h) is unreachable by handheld scanning but trivially exceeded
 * by a relocalization origin jump. Module-internal tuning constant (see
 * {@link ANGULAR_GLITCH_CEILING_RAD_S}).
 */
const LINEAR_GLITCH_CEILING_M_S = 20;

/**
 * User-/consumer-facing motion-filter configuration. Shared by both config
 * shapes that carry it — `ImageCaptureConfig` (what `ImageCaptureManager`
 * consumes) and `ImageCaptureOptions` (the persisted recorder options) — so the
 * one definition cannot drift between them. The window size and glitch ceilings
 * are deliberately NOT here: they are internal tuning constants, not exposed.
 */
export interface MotionFilterConfig {
  /** Master switch for the motion gate. Default `true`. */
  enabled: boolean;
  /** Angular-velocity threshold (rad/s); at/below this a frame is "calm". */
  maxAngularVelocity: number;
  /** Linear-velocity threshold (m/s); at/below this a frame is "calm". */
  maxLinearVelocity: number;
  /**
   * Never-calm safety fallback: once a due capture has waited this many ms it
   * fires regardless of motion, so an interval is never silently lost. A
   * sensible value is ~2× the capture interval.
   */
  maxWaitMs: number;
}

/**
 * Default motion-filter configuration. Enabled by default (plan §1).
 *
 * `maxLinearVelocity` was raised `0.5 → 2.5` m/s on 2026-07-02 after a
 * 5-recording field analysis: at 0.5 m/s (~⅓ of a ~1.4 m/s walking pace) the
 * gate deferred ~90 % of captures to the never-calm `maxWaitMs` fallback,
 * collapsing the walking capture rate from the configured 0.5 Hz to ~0.17 Hz.
 * Measured 1 Hz-averaged walking speed was a tight band (median 1.38, max
 * 1.73 m/s); allowing for higher instantaneous per-frame stride peaks, 2.5 m/s
 * clears steady and brisk walking while still deferring genuine lunges/jogging
 * — demoting the (weak-at-scanning-distance) linear signal to a gross-motion
 * safety net and letting the well-behaved angular gate be the primary blur
 * selector. See
 * `GpsPlusSlamJs_Docs/docs/2026-07-02-0117-image-capture-rate-motion-gate-finding.md`.
 *
 * `maxAngularVelocity` remains a PLACEHOLDER pending on-device field tuning
 * (plan §7). `maxWaitMs` of 4000 ms is 2× the default 2000 ms image interval.
 */
export const DEFAULT_MOTION_FILTER: MotionFilterConfig = {
  enabled: true,
  maxAngularVelocity: 0.6,
  maxLinearVelocity: 2.5,
  maxWaitMs: 4000,
};

/**
 * Valid ranges for the {@link MotionFilterConfig} thresholds — the bounds
 * outside which the gate stops being a gate, so they live with the gate rather
 * than with whichever app persists a config for it.
 *
 * The velocity ranges (0.05–5) bracket the plausible scanning regime: below
 * ~0.05 the gate would reject almost everything; above ~5 rad/s ≈ 286°/s (or
 * 5 m/s) it would never reject, so the gate would be inert. `maxWaitMs` is
 * clamped to 0.5–20 s — the never-calm fallback must always be able to fire.
 * `step` is the granularity a settings slider should use for the value.
 */
export const MOTION_FILTER_CONSTRAINTS = {
  maxAngularVelocity: { min: 0.05, max: 5, step: 0.05 },
  maxLinearVelocity: { min: 0.05, max: 5, step: 0.05 },
  maxWaitMs: { min: 500, max: 20000, step: 500 },
} as const;

/**
 * Validate and normalize a persisted {@link MotionFilterConfig}.
 *
 * `enabled` is boolean-or-default; the three thresholds are clamped to
 * {@link MOTION_FILTER_CONSTRAINTS}, with non-finite values (a stored `NaN` is
 * `typeof 'number'` and would survive a bare clamp) falling back to the
 * default. A missing/nullish group default-fills entirely, so a config
 * persisted before the gate existed loads with the gate ENABLED rather than
 * crashing.
 */
export function validateMotionFilterConfig(
  options: Partial<MotionFilterConfig> | null | undefined
): MotionFilterConfig {
  return validateOptionFields(options, DEFAULT_MOTION_FILTER, {
    enabled: { kind: 'bool' },
    maxAngularVelocity: {
      kind: 'num',
      constraint: MOTION_FILTER_CONSTRAINTS.maxAngularVelocity,
    },
    maxLinearVelocity: {
      kind: 'num',
      constraint: MOTION_FILTER_CONSTRAINTS.maxLinearVelocity,
    },
    maxWaitMs: { kind: 'num', constraint: MOTION_FILTER_CONSTRAINTS.maxWaitMs },
  });
}

/** Inputs to the stateless capture decision. */
export interface CaptureDecisionInput {
  /** Max angular velocity (rad/s) over the recent window. `Infinity` if empty. */
  windowMaxAngular: number;
  /** Max linear velocity (m/s) over the recent window. `Infinity` if empty. */
  windowMaxLinear: number;
  /** Angular-velocity threshold (rad/s); at/below this is "calm". */
  maxAngularVelocity: number;
  /** Linear-velocity threshold (m/s); at/below this is "calm". */
  maxLinearVelocity: number;
  /** Milliseconds since the capture first became due (interval elapsed). */
  msSinceDue: number;
  /** Safety fallback: capture regardless once this many ms have passed. */
  maxWaitMs: number;
}

/**
 * Decide whether a due capture should fire now or defer to a later frame.
 *
 * A frame is "calm" when BOTH windowed maxima are at/below their thresholds —
 * an empty window reports `Infinity`, so it is never calm (no capture before a
 * valid sample exists). If not calm, the capture is deferred UNTIL `msSinceDue`
 * reaches `maxWaitMs`, at which point it fires regardless to guarantee an
 * interval is never silently lost (worst case: one blurry frame, not a gap).
 */
export function decideCapture(
  input: CaptureDecisionInput
): 'capture' | 'defer' {
  const calm =
    input.windowMaxAngular <= input.maxAngularVelocity &&
    input.windowMaxLinear <= input.maxLinearVelocity;
  if (calm) return 'capture';
  if (input.msSinceDue >= input.maxWaitMs) return 'capture';
  return 'defer';
}

/**
 * Fixed-size ring of the most recent VALID (non-glitch) per-frame velocities.
 *
 * `maxAngular()`/`maxLinear()` return the max over the retained samples, or
 * `Infinity` when empty so "no data yet" reads as not-calm in
 * {@link decideCapture}. A sample exceeding either glitch ceiling is rejected
 * outright (`push` returns `false`) and never stored, so a relocalization spike
 * neither pollutes the window (no spurious defer) nor is treated as motion.
 */
export class MotionWindow {
  private readonly size: number;
  private readonly angular: number[] = [];
  private readonly linear: number[] = [];

  constructor(
    size: number = DEFAULT_MOTION_WINDOW_SIZE,
    private readonly angularGlitchCeiling: number = ANGULAR_GLITCH_CEILING_RAD_S,
    private readonly linearGlitchCeiling: number = LINEAR_GLITCH_CEILING_M_S
  ) {
    // Guard against a degenerate/corrupt window size — at least 1 sample.
    this.size = Number.isFinite(size) && size >= 1 ? Math.floor(size) : 1;
  }

  /**
   * Record a per-frame velocity pair. Returns `false` (and stores nothing) when
   * the sample exceeds either glitch ceiling, `true` otherwise.
   */
  push(angularVel: number, linearVel: number): boolean {
    if (
      !Number.isFinite(angularVel) ||
      !Number.isFinite(linearVel) ||
      angularVel > this.angularGlitchCeiling ||
      linearVel > this.linearGlitchCeiling
    ) {
      return false;
    }
    this.angular.push(angularVel);
    this.linear.push(linearVel);
    if (this.angular.length > this.size) this.angular.shift();
    if (this.linear.length > this.size) this.linear.shift();
    return true;
  }

  /** Whether the window holds at least one valid (non-glitch) sample yet. */
  hasSamples(): boolean {
    return this.angular.length > 0;
  }

  /** Max angular velocity over the retained window, or `Infinity` if empty. */
  maxAngular(): number {
    return this.angular.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(...this.angular);
  }

  /** Max linear velocity over the retained window, or `Infinity` if empty. */
  maxLinear(): number {
    return this.linear.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(...this.linear);
  }

  /** Clear all samples (e.g. on tracking loss / capture restart). */
  reset(): void {
    this.angular.length = 0;
    this.linear.length = 0;
  }
}
