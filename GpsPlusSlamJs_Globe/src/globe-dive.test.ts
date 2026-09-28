/**
 * Why this test matters: the pin's dive (round-2 plan 2026-09-26-2055
 * M3g; the owner's "turns the globe towards me and zooms in over about
 * 15 s") is a curve a viewer judges by eye, and its failures are glitches:
 * a jump at the start (the camera snapping from wherever the user left it),
 * a jump at the end (the hand-over altitude missed, so the city opens from
 * somewhere else), a descent that reverses, or a turn still running when
 * the camera is already low. So the ends are exact, the altitude moves one
 * way only and evenly in its logarithm (every halving of the height takes
 * as long as the one before, near the ends eased), and the turn is over
 * before the last stretch.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { GLOBE_DIVE, diveAt } from "./globe-dive.js";

const altitude = fc
  .double({ min: Math.log(1_000), max: Math.log(60_000_000), noNaN: true })
  .map(Math.exp);
const duration = fc.integer({ min: 1, max: 120_000 });

describe("GLOBE_DIVE", () => {
  it("holds the owner's numbers: about 15 s, handed over at 150 km", () => {
    expect(GLOBE_DIVE.durationMs).toBe(15_000);
    expect(GLOBE_DIVE.handOverAltitudeM).toBe(150_000);
    expect(GLOBE_DIVE.turnShare).toBeGreaterThan(0);
    expect(GLOBE_DIVE.turnShare).toBeLessThan(1);
  });
});

describe("diveAt", () => {
  it("starts exactly where the camera is and ends exactly at the hand-over", () => {
    fc.assert(
      fc.property(altitude, altitude, duration, (from, to, durationMs) => {
        const opts = { durationMs, fromAltitudeM: from, toAltitudeM: to };
        const start = diveAt(0, opts);
        expect(start.altitudeM).toBe(from);
        expect(start.turnT).toBe(0);
        expect(start.done).toBe(false);
        const end = diveAt(durationMs, opts);
        expect(end.altitudeM).toBe(to);
        expect(end.turnT).toBe(1);
        expect(end.done).toBe(true);
        // Past the end it holds; before the start it holds.
        expect(diveAt(durationMs * 3, opts).altitudeM).toBe(to);
        expect(diveAt(-5, opts).altitudeM).toBe(from);
      }),
    );
  });

  it("moves the altitude one way only, and the turn forward only", () => {
    fc.assert(
      fc.property(
        altitude,
        altitude,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (from, to, a, b) => {
          const opts = {
            durationMs: 15_000,
            fromAltitudeM: from,
            toAltitudeM: to,
          };
          const [early, late] = a <= b ? [a, b] : [b, a];
          const p = diveAt(early * 15_000, opts);
          const q = diveAt(late * 15_000, opts);
          const lo = Math.min(from, to) * (1 - 1e-12);
          const hi = Math.max(from, to) * (1 + 1e-12);
          expect(p.altitudeM).toBeGreaterThanOrEqual(lo);
          expect(p.altitudeM).toBeLessThanOrEqual(hi);
          // Later is never farther from the end than earlier.
          const towards = Math.sign(to - from);
          expect(towards * (q.altitudeM - p.altitudeM)).toBeGreaterThanOrEqual(
            -1e-12 * p.altitudeM,
          );
          expect(q.turnT).toBeGreaterThanOrEqual(p.turnT);
        },
      ),
    );
  });

  it("descends evenly in the logarithm: half way in time is the geometric mean", () => {
    const opts = {
      durationMs: 15_000,
      fromAltitudeM: 10_000_000,
      toAltitudeM: 150_000,
    };
    const mid = diveAt(7_500, opts);
    expect(mid.altitudeM).toBeCloseTo(Math.sqrt(10_000_000 * 150_000), 3);
  });

  it("finishes the turn by the turn share of the dive, and eases it", () => {
    const opts = {
      durationMs: 15_000,
      fromAltitudeM: 10_000_000,
      toAltitudeM: 150_000,
    };
    const turnEnd = GLOBE_DIVE.turnShare * 15_000;
    expect(diveAt(turnEnd, opts).turnT).toBe(1);
    expect(diveAt(turnEnd / 2, opts).turnT).toBeCloseTo(0.5, 12);
    // Eased: slow at the start.
    expect(diveAt(turnEnd * 0.1, opts).turnT).toBeLessThan(0.1);
  });

  it("has no jump: a millisecond moves the altitude by under half a percent", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 14_999 }), (ms) => {
        const opts = {
          durationMs: 15_000,
          fromAltitudeM: 10_000_000,
          toAltitudeM: 20_000,
        };
        const a = diveAt(ms, opts).altitudeM;
        const b = diveAt(ms + 1, opts).altitudeM;
        expect(Math.abs(Math.log(b / a))).toBeLessThan(0.005);
      }),
    );
  });

  it("refuses a duration or altitude it cannot fly", () => {
    const ok = { durationMs: 15_000, fromAltitudeM: 1e7, toAltitudeM: 1.5e5 };
    expect(() => diveAt(0, ok)).not.toThrow();
    for (const bad of [
      { durationMs: 0 },
      { durationMs: Number.NaN },
      { fromAltitudeM: 0 },
      { toAltitudeM: -1 },
      { toAltitudeM: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => diveAt(0, { ...ok, ...bad })).toThrow(RangeError);
    }
  });
});
