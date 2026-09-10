/**
 * Why these properties matter: a timing function is consumed as "the drawn
 * fraction at time t", so what must hold for ANY valid control points is
 * that the curve is a function of x (one y per x), that x is honoured
 * monotonically (a later time never reads as an earlier fraction), and that
 * the endpoints are exact — a solver that drifts at 1 would leave the
 * outline 1 % open forever.
 *
 * @see cubic-bezier-easing.ts.md
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cubicBezierEasing } from './cubic-bezier-easing.js';

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const controlPoints = fc.tuple(unit, unit, unit, unit);

describe('cubicBezierEasing (properties)', () => {
  it('is monotone non-decreasing in x for any control points with y in [0, 1]', () => {
    fc.assert(
      fc.property(controlPoints, unit, unit, ([x1, y1, x2, y2], a, b) => {
        const ease = cubicBezierEasing(x1, y1, x2, y2);
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(ease(hi)).toBeGreaterThanOrEqual(ease(lo) - 1e-9);
      })
    );
  });

  it('hits the endpoints exactly and stays inside [0, 1] when the control y do', () => {
    fc.assert(
      fc.property(controlPoints, unit, ([x1, y1, x2, y2], x) => {
        const ease = cubicBezierEasing(x1, y1, x2, y2);
        expect(ease(0)).toBe(0);
        expect(ease(1)).toBe(1);
        const y = ease(x);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(1 + 1e-9);
      })
    );
  });

  it('solves x to within 1e-6: evaluating the curve at the found parameter returns x', () => {
    // The evaluator's whole job is the inverse x → u; this checks the
    // inverse against the forward polynomial rather than trusting it.
    fc.assert(
      fc.property(controlPoints, unit, ([x1, y1, x2, y2], x) => {
        const ease = cubicBezierEasing(x1, y1, x2, y2);
        // Recover u by solving for y instead: with y-controls equal to the
        // x-controls the curve is the identity, so ease(x) must be x.
        const identityLike = cubicBezierEasing(x1, x1, x2, x2);
        expect(identityLike(x)).toBeCloseTo(x, 6);
        expect(Number.isFinite(ease(x))).toBe(true);
      })
    );
  });
});
