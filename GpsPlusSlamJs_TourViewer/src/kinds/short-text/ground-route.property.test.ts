/**
 * Why these tests matter: every ground style is laid along this one
 * route, so its promises are what a visitor sees whatever the style - the
 * arrow starts at its spot, ends pointing at its target, never runs into
 * the last 2 m before it, bends to the side the record says, and grows
 * with its one scale within the curves' bounds. A route that broke one of
 * them would walk a visitor into the thing it points at, or point past it.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  TOUR_GROUND_MAX_BEND_DEG,
  TOUR_SHORT_TEXT_MAX_READ_AT_M,
  TOUR_SHORT_TEXT_MIN_READ_AT_M,
} from "gps-plus-slam-app-framework/ar/tour-short-text";

import {
  GROUND,
  GROUND_SUN_MIN_RATIO,
  groundBendDeg,
  groundFloatM,
  groundLengthM,
  groundLetterM,
  groundRingM,
  groundRoute,
  groundScale,
  groundScaleAtRingM,
  routeAt,
  sunContrast,
} from "./ground-route.js";

const coord = fc.double({ min: -60, max: 60, noNaN: true });
const target = fc.record({ x: coord, z: coord });
const scale = fc.double({
  min: TOUR_SHORT_TEXT_MIN_READ_AT_M,
  max: TOUR_SHORT_TEXT_MAX_READ_AT_M,
  noNaN: true,
});
const bend = fc.double({ min: -90, max: 90, noNaN: true });

describe("the ground route", () => {
  it("starts at the spot and ends on the straight line, short of the target by at least the stop", () => {
    fc.assert(
      fc.property(target, scale, bend, (t, s, b) => {
        const r = groundRoute({ target: t, scale: s, bendDeg: b });
        const D = Math.hypot(t.x, t.z);
        expect(r.none).toBe(D - GROUND.stopM < GROUND.routeMinM);
        if (r.none) return;
        const first = r.path.pts[0]!;
        const last = r.path.pts.at(-1)!;
        expect(Math.hypot(first.x, first.z)).toBeLessThan(1e-9);
        // The end lies on the line to the target, `lengthM` along it.
        expect(last.x).toBeCloseTo((t.x / D) * r.lengthM, 9);
        expect(last.z).toBeCloseTo((t.z / D) * r.lengthM, 9);
        expect(D - r.lengthM).toBeGreaterThanOrEqual(GROUND.stopM - 1e-9);
        expect(r.lengthM).toBeLessThanOrEqual(groundLengthM(s) + 1e-9);
        // Nothing of it comes nearer the target than the stop.
        for (const q of r.path.pts) {
          expect(Math.hypot(t.x - q.x, t.z - q.z)).toBeGreaterThan(
            GROUND.stopM - 0.05,
          );
        }
      }),
    );
  });

  it("leaves turned by the held bend and arrives pointing at the target", () => {
    fc.assert(
      fc.property(target, scale, bend, (t, s, b) => {
        const r = groundRoute({ target: t, scale: s, bendDeg: b });
        if (r.none) return;
        const held = groundBendDeg(b);
        expect(Math.abs(held)).toBeLessThanOrEqual(TOUR_GROUND_MAX_BEND_DEG);
        // The turn from the straight line to the start's direction,
        // clockwise seen from above (to the right) positive.
        const cross = r.dirX * r.t0Z - r.dirZ * r.t0X;
        const dot = r.dirX * r.t0X + r.dirZ * r.t0Z;
        expect((Math.atan2(cross, dot) * 180) / Math.PI).toBeCloseTo(held, 6);
        const end = routeAt(r.path, r.path.L);
        expect(end.tx).toBeCloseTo(r.dirX, 6);
        expect(end.tz).toBeCloseTo(r.dirZ, 6);
      }),
    );
  });

  it("strays to the side of the bend, and runs straight without one", () => {
    fc.assert(
      fc.property(
        target,
        scale,
        fc.double({ min: 5, max: 60, noNaN: true }),
        (t, s, b) => {
          for (const sign of [1, -1]) {
            const r = groundRoute({ target: t, scale: s, bendDeg: sign * b });
            if (r.none) return;
            expect(Math.sign(r.sideM)).toBe(sign);
          }
          const straight = groundRoute({ target: t, scale: s, bendDeg: 0 });
          expect(straight.none ? 0 : Math.abs(straight.sideM)).toBeLessThan(
            1e-6,
          );
        },
      ),
    );
  });

  it("is sampled densely and in order, its length at least the straight line's", () => {
    fc.assert(
      fc.property(target, scale, bend, (t, s, b) => {
        const r = groundRoute({ target: t, scale: s, bendDeg: b });
        if (r.none) return;
        expect(r.path.L).toBeGreaterThanOrEqual(r.lengthM - 1e-9);
        for (let i = 1; i < r.path.pts.length; i++) {
          const p = r.path.pts[i]!;
          const q = r.path.pts[i - 1]!;
          expect(p.s).toBeGreaterThan(q.s);
          expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThanOrEqual(
            GROUND.sampleM + 1e-6,
          );
        }
      }),
    );
  });

  it("runs straight ahead along the front with no target, with no stop", () => {
    fc.assert(
      fc.property(scale, (s) => {
        const r = groundRoute({ target: null, scale: s });
        expect(r.none).toBe(false);
        if (r.none) return;
        expect([r.dirX, r.dirZ]).toEqual([0, 1]);
        expect(r.lengthM).toBeCloseTo(groundLengthM(s), 9);
      }),
    );
  });

  it("keeps a style's own longest", () => {
    const r = groundRoute({
      target: { x: 0, z: 50 },
      scale: 40,
      lenCapM: 8,
    });
    expect(r.none ? null : r.lengthM).toBe(8);
  });
});

describe("the one scale", () => {
  it("grows the letters and the length with it, each within its curve's bounds", () => {
    fc.assert(
      fc.property(scale, scale, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(groundLetterM(lo)).toBeLessThanOrEqual(groundLetterM(hi));
        expect(groundLengthM(lo)).toBeLessThanOrEqual(groundLengthM(hi));
        expect(groundLengthM(lo)).toBeGreaterThanOrEqual(GROUND.lenMin);
        expect(groundLengthM(hi)).toBeLessThanOrEqual(GROUND.lenMax);
      }),
    );
  });

  it("follows the target's distance until one is set, and holds a set one to the format", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2000, noNaN: true }), (d) => {
        const s = groundScale(undefined, d);
        expect(s).toBeGreaterThanOrEqual(GROUND.defMin);
        expect(s).toBeLessThanOrEqual(GROUND.defMax);
        expect(groundScale(undefined, d + 1)).toBeGreaterThanOrEqual(s);
      }),
    );
    expect(groundScale(undefined, null)).toBe(GROUND.defNoTarget);
    expect(groundScale(7, 400)).toBe(7);
    expect(groundScale(99, null)).toBe(TOUR_SHORT_TEXT_MAX_READ_AT_M);
  });

  it("is read back from its circle's radius, so a dragged dot stays under the pointer", () => {
    fc.assert(
      fc.property(scale, (s) => {
        expect(groundScaleAtRingM(groundRingM(s))).toBeCloseTo(s, 9);
      }),
    );
    expect(groundScaleAtRingM(0)).toBe(TOUR_SHORT_TEXT_MIN_READ_AT_M);
    expect(groundScaleAtRingM(1000)).toBe(TOUR_SHORT_TEXT_MAX_READ_AT_M);
  });
});

describe("the sun warning", () => {
  it("rates contrast against pale paving: the paving itself none, near black plenty", () => {
    expect(sunContrast("#c1c3c3")).toBeCloseTo(1, 1);
    expect(sunContrast("#151a20")).toBeGreaterThan(GROUND_SUN_MIN_RATIO);
    // A pale yellow reads as faintly as the stone it lies on.
    expect(sunContrast("#f1d79c")).toBeLessThan(GROUND_SUN_MIN_RATIO);
    expect(sunContrast("red")).toBeNaN();
  });

  it("is a ratio of at least 1 for every colour", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffff }), (n) => {
        const hex = `#${n.toString(16).padStart(6, "0")}`;
        expect(sunContrast(hex)).toBeGreaterThanOrEqual(1);
      }),
    );
  });
});

describe("the float", () => {
  it("stays within its amplitude and moves with time alone", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.double({ min: 0, max: 1e5, noNaN: true }),
        (seed, t) => {
          const y = groundFloatM(seed, t);
          expect(Math.abs(y)).toBeLessThanOrEqual(0.025 + 1e-12);
          expect(groundFloatM(seed, t)).toBe(y);
        },
      ),
    );
  });
});
