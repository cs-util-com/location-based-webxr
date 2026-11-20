/**
 * The two small helpers the splat trainer's planning modules share: the
 * distance between two points and the guard for a positive setting.
 *
 * @see splat-math.ts.md
 */

import type { Vector3 } from "gps-plus-slam-app-framework/core";

/** Euclidean distance between two points (m). */
export function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/** Throws a RangeError naming `name` unless `value` is positive and finite
 *  (NaN, 0, negatives and infinities are refused). */
export function requirePositive(name: string, value: number): void {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(
      `${name} must be a positive finite number, got ${String(value)}`,
    );
  }
}
