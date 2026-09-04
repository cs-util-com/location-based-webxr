/**
 * The framework's one bearing normalizer.
 *
 * WHY IT EXISTS AS A MODULE. `((deg % 360) + 360) % 360` was written six
 * times in this package, never named — `ar/qr/qr-geo-pose-minting.ts`,
 * `ar/qr/qr-level.ts`, `utils/qr-payload/codec-binary-anchor.ts`,
 * `utils/user-heading.ts`, `visualization/heading-up-rotation.ts` and
 * `visualization/lerp-utils.ts`. No guard in this repo could see any of
 * them: `duplicate-helpers.test.js` matches DECLARATIONS, and `check:dup`
 * runs jscpd at a 50-token floor.
 *
 * **The early return is a correctness fix, not a micro-optimisation**, and
 * it is the reason this is a shared contract rather than a convenience. The
 * core library learned it the hard way: without it, an input of `360 − ε`
 * re-enters the double-mod, `(360 − ε) + 360` rounds to exactly `720`, and
 * the result snaps to `0` — a full turn that never happened (fast-check
 * counterexample `−2.842e−14`, fixed in the library 2026-07-20). The bare
 * form also perturbs already-in-range values, because `x + 360` is not
 * exactly representable for most `x`: `0.1` comes back as
 * `0.10000000000002274`.
 *
 * NOT IMPORTED FROM THE CORE LIBRARY, for now. The library has the same
 * function, corrected and property-tested — but it exports only its sibling
 * `bearingDeltaDeg` publicly, so reaching this one would mean growing the
 * library's public API while the API-NARROWING pass (DEC-N7) is parked, and
 * would couple a framework release to a library release. Recorded as a
 * parked question in the simplify-loop state doc rather than decided here.
 *
 * @see bearing-degrees.ts.md
 */

/**
 * Wrap a bearing in degrees into `[0, 360)`.
 *
 * **Exactly idempotent**: an input already in range is returned unchanged,
 * which is what avoids both the full-turn snap at `360 − ε` and the
 * round-trip precision loss described above. Non-finite input propagates
 * (`NaN` in, `NaN` out) — callers that must not leak a `NaN` guard before
 * calling, as `user-heading.ts` does.
 */
export function normalizeBearingDeg(deg: number): number {
  if (deg >= 0 && deg < 360) return deg;
  return ((deg % 360) + 360) % 360;
}

/**
 * Signed shortest difference `a − b` between two bearings, in `(−180, 180]`.
 *
 * Built on {@link normalizeBearingDeg}, so it inherits the full-turn contract
 * above. Exactly opposite bearings return `+180`, never `−180`, so the sign
 * is well defined at the boundary. Non-finite input propagates.
 *
 * Replaced two unnamed copies (2026-09-04, simplify loop): the recorder's
 * `ui/yaw-churn.ts` and the `+ 540` form in `visualization/lerp-utils.ts`,
 * which gave `−180` at the boundary — two conventions for one quantity.
 */
export function bearingDeltaDeg(a: number, b: number): number {
  const d = normalizeBearingDeg(a - b);
  return d > 180 ? d - 360 : d;
}
