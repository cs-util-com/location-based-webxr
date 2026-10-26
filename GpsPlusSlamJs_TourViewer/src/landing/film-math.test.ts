/**
 * Why these tests matter: the film's parts were written against the prototype's
 * own curves (`sm`, `eo`, `bk`: smoothstep, ease-out cubic, back-out).
 * The port evaluates them through the framework's shared CSS bezier
 * solver instead of private copies, which is only right if the beziers
 * chosen ARE those curves, not look-alikes: a look-alike moves every
 * frame between the endpoints (the drift the shared solver exists to
 * prevent). These tests pin the identity against the closed forms.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  backOut,
  bump,
  clamp01,
  easeOut,
  seg,
  smoothEase,
} from "./film-math.js";

const sm = (x: number) => x * x * (3 - 2 * x);
const eo = (x: number) => 1 - (1 - x) ** 3;
const bk = (x: number) => {
  const c = 1.7;
  return x <= 0 ? 0 : 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};

describe("film math: the curves are the prototype's, exactly", () => {
  it("matches smoothstep, ease-out cubic and back-out across [0, 1]", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (x) => {
        expect(smoothEase(x)).toBeCloseTo(sm(x), 9);
        expect(easeOut(x)).toBeCloseTo(eo(x), 9);
        expect(backOut(x)).toBeCloseTo(bk(x), 9);
      }),
    );
  });

  it("clamps outside [0, 1], so a part's early or late moment never overshoots", () => {
    expect(smoothEase(-1)).toBe(0);
    expect(smoothEase(2)).toBe(1);
    expect(easeOut(Number.NaN)).toBe(0);
    expect(backOut(5)).toBe(1);
  });

  it("back-out overshoots inside, which is why the pins bounce", () => {
    expect(Math.max(...[0.6, 0.7, 0.8].map(backOut))).toBeGreaterThan(1);
  });
});

describe("film math: seg, bump, clamp01", () => {
  it("seg is the clamped progress through [a, b]", () => {
    expect(seg(0.5, 0, 1)).toBe(0.5);
    expect(seg(-1, 0, 1)).toBe(0);
    expect(seg(3, 1, 2)).toBe(1);
    expect(seg(1.5, 1, 2)).toBe(0.5);
  });

  it("bump is a single hump, 0 outside (0, 1)", () => {
    expect(bump(0)).toBe(0);
    expect(bump(1)).toBe(0);
    expect(bump(0.5)).toBeCloseTo(1, 12);
    expect(bump(-0.2)).toBe(0);
  });

  it("clamp01 reads non-finite input as 0, the framework's contract", () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.25)).toBe(0.25);
  });
});
