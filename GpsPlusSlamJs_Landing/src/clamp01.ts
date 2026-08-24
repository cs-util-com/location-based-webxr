/**
 * The landing page's one `clamp01`.
 *
 * WHY IT EXISTS AS A MODULE. It was written twice — in `scroll-color.ts` and
 * `scroll-story.ts` — as `v < 0 ? 0 : v > 1 ? 1 : v`, which passes `NaN`
 * straight through. Both call sites divide by a pixel span, so a zero span
 * produces `NaN` or `Infinity` and the old form carried that into a colour
 * interpolation or a progress value. Returning `0` is the readable failure.
 *
 * The contract matches the framework's `utils/clamp01.ts` exactly. The two are
 * separate copies on purpose (owner decision DEC-H3, 2026-08-24: shared
 * BEHAVIOUR is unified across packages, pure one-liners are not) — this package
 * deliberately does not depend on the framework.
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
