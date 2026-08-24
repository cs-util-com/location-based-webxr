/**
 * The package's one `clamp01`.
 *
 * WHY IT EXISTS AS A MODULE. There were three copies in this package —
 * `state/onboarding-guidance.ts`, `state/tracking-quality.ts` and
 * `test-utils/elevation-offset-scenarios.ts` — and they did NOT agree:
 *
 * - one guarded `Number.isNaN` (so `Infinity` clamped to 1),
 * - one guarded `Number.isFinite` (so `Infinity` collapsed to 0),
 * - one was `Math.min(1, Math.max(0, x))` (so `NaN` passed straight through).
 *
 * That is the whole argument against "a one-liner is too small to share": the
 * duplication was invisible, and the divergence was in the one part of the
 * behaviour nobody reads — what happens to a value that should not exist.
 *
 * THE CONTRACT IS THE STRICTEST OF THE THREE, deliberately. Everything this
 * clamps is a SCORE or a CONFIDENCE, and for those the safe reading of garbage
 * is "no confidence", not "full confidence" — so a non-finite input becomes 0
 * rather than being carried forward as `NaN` or rounded up to 1.
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
