/**
 * The landing page's one `clamp01`.
 *
 * WHY IT EXISTS AS A MODULE. It was written twice — in `scroll-color.ts` and
 * `scroll-story.ts` — as `v < 0 ? 0 : v > 1 ? 1 : v`, which passes `NaN`
 * straight through.
 *
 * **The non-finite case is defence in depth, not a bug being fixed**, and the
 * first version of this comment claimed otherwise. Both callers divide by a
 * pixel span, so a zero span would produce `NaN` or `Infinity` — but a review
 * traced them and neither can reach here with one: `scroll-color.ts` returns
 * early for every non-finite input and for both ends of its band before the
 * division, and `scroll-story.ts` guards on `height > 0` and on a non-empty
 * section list. The claim that a `NaN` "used to reach a colour interpolation"
 * was written without checking, and it was wrong.
 *
 * The contract is still worth having — it is what makes the guard total, so the
 * next caller does not have to repeat that analysis — but it buys robustness,
 * not a defect.
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
