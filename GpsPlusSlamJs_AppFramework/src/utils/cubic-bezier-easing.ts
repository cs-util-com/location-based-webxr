/**
 * CSS `cubic-bezier(x1, y1, x2, y2)` timing functions, evaluated the way a
 * browser evaluates them: the curve runs from (0, 0) to (1, 1) through the
 * two control points, x is the input time and y the output progress, so a
 * call solves x → u on the parametric curve and reads y(u).
 *
 * Exists because the wayfinding HUD mirrors a design-system animation whose
 * easing is the token `--ease-out: cubic-bezier(0, 0, 0.2, 1)`; a
 * hand-picked `easeOutCubic` would look right and drift from the CSS in
 * every frame between. SHARED behaviour per DEC-H3 (the root CLAUDE.md): a
 * solver, not a one-liner, and the easing every future CSS-mirroring
 * animation in the framework needs. Deep-imported
 * (`gps-plus-slam-app-framework/utils/cubic-bezier-easing`), NOT on the
 * `/utils` barrel, so a consumer does not pull the logger and friends for
 * one curve. Guarded as a CANONICAL `shared` entry in the webxr root's
 * `tests/repo-config/duplicate-helpers.test.js`.
 *
 * @see cubic-bezier-easing.ts.md
 */
import { clamp01 } from './clamp01.js';

/** A timing function: input time in [0, 1] → output progress. */
export type EasingFunction = (x: number) => number;

/**
 * The x → u inverse is a bisection on the (monotone, because the control
 * x are in [0, 1]) forward polynomial. 52 halvings reach double precision;
 * the loop stops early when the residual is below `TOLERANCE`.
 */
const MAX_ITERATIONS = 52;
const TOLERANCE = 1e-12;

function assertControlPoint(name: string, value: number, unitRange: boolean) {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `cubicBezierEasing: ${name} must be a finite number, got ${value}`
    );
  }
  if (unitRange && (value < 0 || value > 1)) {
    throw new RangeError(
      `cubicBezierEasing: ${name} must be within [0, 1] (CSS requires it, and the curve is only a function of x then), got ${value}`
    );
  }
}

/**
 * Build the timing function for `cubic-bezier(x1, y1, x2, y2)`.
 *
 * - `x1`, `x2` must be finite and within [0, 1] (as CSS requires; that is
 *   what makes x monotone in the parameter, i.e. the curve a function).
 *   `y1`, `y2` must be finite; values outside [0, 1] are legal (overshoot).
 * - The returned function clamps its input with the canonical `clamp01`
 *   (below 0 → 0, above 1 → 1, non-finite → 0) and returns y(u) for the u
 *   whose x(u) equals the input. The endpoints are exact: 0 → 0, 1 → 1.
 * - Throws `RangeError` on an invalid control point, at build time, never
 *   per call.
 */
export function cubicBezierEasing(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): EasingFunction {
  assertControlPoint('x1', x1, true);
  assertControlPoint('y1', y1, false);
  assertControlPoint('x2', x2, true);
  assertControlPoint('y2', y2, false);

  // Bernstein form with the fixed endpoints (0, 0) and (1, 1):
  //   p(u) = 3(1−u)²u·p1 + 3(1−u)u²·p2 + u³
  const forward = (p1: number, p2: number, u: number): number => {
    const v = 1 - u;
    return 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u;
  };

  return (input: number): number => {
    const x = clamp01(input);
    if (x === 0) return 0;
    if (x === 1) return 1;
    let lo = 0;
    let hi = 1;
    let u = 0.5; // overwritten by the first halving; a bisection has no seed
    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
      u = (lo + hi) / 2;
      const residual = forward(x1, x2, u) - x;
      if (Math.abs(residual) < TOLERANCE) break;
      if (residual < 0) lo = u;
      else hi = u;
    }
    return forward(y1, y2, u);
  };
}

/** The design system's `--ease-out: cubic-bezier(0, 0, 0.2, 1)`. */
export const EASE_OUT: EasingFunction = cubicBezierEasing(0, 0, 0.2, 1);
