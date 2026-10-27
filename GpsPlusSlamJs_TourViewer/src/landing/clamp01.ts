/**
 * The Tour Viewer's one `clamp01` (a pure one-liner may exist once per
 * package), for the landing: an intersection share read
 * from the browser, a timeline fraction.
 *
 * The contract is the framework's `utils/clamp01.ts`, copied exactly: that
 * module is no deep-import entry of the framework's build, and making it one
 * would put every dependent of the framework behind this package's change
 * (the reason `editor3d-visibility.ts` keeps its own `smoothstep`). A share
 * that is not a number means "nothing known in view", so non-finite input
 * reads as 0.
 *
 * @see clamp01.ts.md
 */

/** Clamps `value` into `[0, 1]`. Non-finite input (`NaN`, `±Infinity`) → `0`. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
