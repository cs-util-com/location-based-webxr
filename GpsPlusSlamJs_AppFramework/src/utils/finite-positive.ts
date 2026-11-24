/**
 * The finite-positive rule for measured values (accuracies, sizes,
 * extents) from sensors and files, and how two accuracies combine.
 *
 * @see finite-positive.ts.md
 */

/** `v` when it is a finite number above zero, else null. */
export function finitePositive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** The worse (larger) of two accuracies; either alone when the other is
 *  null, null when both are. */
export function worse(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}
