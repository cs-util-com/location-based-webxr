/**
 * Shared lerp utilities for visualization modules.
 *
 * Both alignment-lerper and camera-follower need the same smoothing
 * rate constant and clamped-alpha formula. Centralised here (R3) to
 * keep the two modules in sync.
 */
import { normalizeBearingDeg } from '../utils/bearing-degrees.js';

/** Default speed multiplier — ~90 % convergence in ~0.3 s at 60 fps. */
export const DEFAULT_LERP_RATE = 8;

/**
 * Compute a frame-rate-independent lerp/slerp factor clamped to [0, 1].
 *
 * Both bounds are clamped: the upper bound caps an overlong frame at a full
 * (instant) step, and the lower bound rejects a negative `dt` (system clock
 * adjustment, a frame loop whose timestamp runs backward, or a paused-then-
 * resumed tab). Without the lower clamp a negative `dt` would yield a negative
 * alpha and the angle/quaternion lerp would extrapolate BACKWARD, away from the
 * target — a visible heading/alignment jump.
 *
 * @param lerpRate Speed multiplier (higher = faster convergence).
 * @param dt       Delta time in seconds since last frame.
 * @returns The interpolation alpha, guaranteed within [0, 1].
 */
export function clampedAlpha(lerpRate: number, dt: number): number {
  return Math.min(Math.max(lerpRate * dt, 0), 1.0);
}

/**
 * Interpolate between two angles (degrees) along the SHORTEST arc.
 *
 * Used by the heading-up minimap to smooth the map's yaw toward a ~1 Hz target
 * heading every frame without spinning the long way across the 0°/360° seam
 * (e.g. 350° → 10° goes +20° through 0°, not −340° through 180°).
 *
 * @param current Current angle in degrees (any range; normalized internally).
 * @param target  Target angle in degrees (any range).
 * @param alpha   Interpolation factor — 0 returns `current`, 1 returns `target`.
 *                Values outside [0, 1] extrapolate; callers should clamp (see
 *                {@link clampedAlpha}).
 * @returns The interpolated angle normalized to `[0, 360)`.
 */
export function lerpAngleDeg(
  current: number,
  target: number,
  alpha: number
): number {
  // Shortest signed delta in (−180, 180].
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  const result = current + delta * alpha;
  return normalizeBearingDeg(result);
}
