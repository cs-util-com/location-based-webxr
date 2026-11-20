/**
 * Why this test matters: the travelling box's rules run every frame on a
 * walking visitor's phone, over inputs no example list covers. These hold
 * for any input what the examples only sample: the place never moves under
 * a finger or inside the lock after it, a move needs its hold time, hidden
 * acts at once, a letter size between the keep line and the threshold
 * never throws the words off their plate; the flight's corners stay
 * between their plate and their dock and inside the depth range; the
 * letter size falls as one over the depth and a turned plate never reads
 * wider than tall; and the easing is monotone with its ends fixed.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  easeInOutCubic,
  flightClip,
  letterGate,
  plateMetrics,
  settlePlace,
  TRAVELLING_BOX_DEFAULTS,
  wantPlace,
  type PlateMetrics,
  type SettleState,
  type TravelPlace,
} from "./travelling-box-rules";

const K = TRAVELLING_BOX_DEFAULTS;
const place = fc.constantFrom<TravelPlace>("plate", "dock", "hidden");
const shown = fc.constantFrom<TravelPlace>("plate", "dock");
const dt = fc.double({ min: 0, max: 0.2, noNaN: true });
const state = fc.record({
  place,
  pending: fc.option(place, { nil: null }),
  pendingS: fc.double({ min: 0, max: 2, noNaN: true }),
});

describe("settlePlace for any input", () => {
  it("never moves between plate and dock under a finger or inside the lock", () => {
    fc.assert(
      fc.property(
        state,
        shown,
        shown,
        dt,
        fc.boolean(),
        fc.double({ min: 0, max: K.lock, maxExcluded: true, noNaN: true }),
        (s0, from, to, d, finger, since) => {
          const s = { ...s0, place: from };
          const input = finger
            ? { fingerDown: true, sinceReleaseS: 0 }
            : { fingerDown: false, sinceReleaseS: since };
          expect(settlePlace(s, to, d, input, K).place).toBe(from);
        },
      ),
    );
  });

  it("moves between plate and dock only after the want has held its hold time", () => {
    fc.assert(
      fc.property(
        shown,
        fc.array(dt, { minLength: 1, maxLength: 40 }),
        (from, steps) => {
          const to: TravelPlace = from === "plate" ? "dock" : "plate";
          const hold = to === "dock" ? K.holdDock : K.holdPlate;
          // It moves on the first frame its want has held `hold` (counted
          // from the frame after it appeared), and not one frame earlier.
          let s: SettleState = { place: from, pending: null, pendingS: 0 };
          let held = 0;
          let movedAt = -1;
          let mayMoveAt = -1;
          for (const [i, d] of steps.entries()) {
            s = settlePlace(
              s,
              to,
              d,
              { fingerDown: false, sinceReleaseS: Infinity },
              K,
            );
            if (i > 0) held += d;
            if (movedAt < 0 && s.place === to) movedAt = i;
            if (mayMoveAt < 0 && held >= hold) mayMoveAt = i;
          }
          expect(movedAt).toBe(mayMoveAt);
        },
      ),
    );
  });

  // Why: with equal holds a swapped dock and plate hold passes unseen;
  // unequal ones pin which hold each move waits for.
  it("waits the dock's hold to dock and the plate's to leave the dock, when they differ", () => {
    const knobs = { ...K, holdDock: 0.3, holdPlate: 0.6 };
    fc.assert(
      fc.property(
        shown,
        fc.array(dt, { minLength: 1, maxLength: 60 }),
        (from, steps) => {
          const to: TravelPlace = from === "plate" ? "dock" : "plate";
          const hold = to === "dock" ? 0.3 : 0.6;
          let s: SettleState = { place: from, pending: null, pendingS: 0 };
          let held = 0;
          let movedAt = -1;
          let mayMoveAt = -1;
          for (const [i, d] of steps.entries()) {
            s = settlePlace(
              s,
              to,
              d,
              { fingerDown: false, sinceReleaseS: Infinity },
              knobs,
            );
            if (i > 0) held += d;
            if (movedAt < 0 && s.place === to) movedAt = i;
            if (mayMoveAt < 0 && held >= hold) mayMoveAt = i;
          }
          expect(movedAt).toBe(mayMoveAt);
        },
      ),
    );
  });

  it("hides at once, whatever the finger, the lock or the hold", () => {
    fc.assert(
      fc.property(
        state,
        dt,
        fc.boolean(),
        fc.double({ min: 0, max: 5, noNaN: true }),
        (s, d, finger, since) => {
          const out = settlePlace(
            s,
            "hidden",
            d,
            { fingerDown: finger, sinceReleaseS: since },
            K,
          );
          expect(out.place).toBe("hidden");
        },
      ),
    );
  });

  it("keeps the words on their plate for any letter size in [thr x keep, thr)", () => {
    // Why: the keep band is the hysteresis; a size inside it that docked
    // a plate already shown would make the words flicker at the threshold.
    fc.assert(
      fc.property(
        fc.double({
          min: K.thr * K.keep,
          max: K.thr,
          maxExcluded: true,
          noNaN: true,
        }),
        fc.array(dt, { maxLength: 40 }),
        (letterPx, steps) => {
          const metrics: PlateMetrics = {
            valid: true,
            onScreen: true,
            ndcX: 0,
            ndcY: 0,
            letterPxH: letterPx,
            letterPxW: letterPx,
            letterPx,
            linePx: letterPx,
          };
          let s: SettleState = { place: "plate", pending: null, pendingS: 0 };
          for (const d of steps) {
            const w = wantPlace(
              {
                travelling: true,
                hideWhy: null,
                gates: [letterGate(metrics, K)],
                metrics,
                angleDeg: 0,
                onPlate: s.place === "plate",
                slotFree: true,
                canFold: false,
              },
              K,
            );
            s = settlePlace(
              s,
              w.place,
              d,
              { fingerDown: false, sinceReleaseS: Infinity },
              K,
            );
            expect(s.place).toBe("plate");
          }
        },
      ),
    );
  });
});

const coord = fc.double({ min: -5, max: 5, noNaN: true });
const corner = fc
  .tuple(
    coord,
    coord,
    fc.double({ min: 0.1, max: 20, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .map(([x, y, w, zf]) => [x, y, zf * w, w] as const);

describe("flightClip for any plate and dock", () => {
  it("keeps each corner between its plate and its dock, inside the depth range", () => {
    fc.assert(
      fc.property(
        fc.array(corner, { minLength: 4, maxLength: 4 }),
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
          minLength: 8,
          maxLength: 8,
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (corners, dock, e) => {
          const src = corners.flat();
          const out = flightClip(src, dock, e, new Array<number>(16));
          for (let i = 0; i < 4; i++) {
            const [sx, sy, , sw] = corners[i]!;
            const w = out[i * 4 + 3]!;
            expect(w).toBeGreaterThan(0);
            expect(Math.abs(out[i * 4 + 2]!)).toBeLessThanOrEqual(w + 1e-9);
            for (const [c, s, t] of [
              [out[i * 4]! / w, sx / sw, dock[i * 2]!],
              [out[i * 4 + 1]! / w, sy / sw, dock[i * 2 + 1]!],
            ] as const) {
              expect(c).toBeGreaterThanOrEqual(Math.min(s, t) - 1e-9);
              expect(c).toBeLessThanOrEqual(Math.max(s, t) + 1e-9);
            }
          }
        },
      ),
    );
  });
});

/** A level camera at the plate's centre height looking down -z, a 390 x
 *  844 view with lens 1.2: the clip coordinates of a view-space point. */
const VIEW_W = 390;
const VIEW_H = 844;
const LENS = 1.2;
function clipOf(x: number, y: number, z: number): number[] {
  return [(LENS * VIEW_H * x) / VIEW_W, LENS * y, 0, -z];
}

/** A plate 2.312 x 0.918 m (the travel box) at depth `depth` on the
 *  axis, turned by `yaw` about its upright axis. */
function plateAt(depth: number, yaw: number): PlateMetrics {
  const q = 2.312 / 2;
  const h = 0.918 / 2;
  const cx = q * Math.cos(yaw);
  const cz = q * Math.sin(yaw);
  const corners = [
    clipOf(-cx, h, -depth - cz),
    clipOf(cx, h, -depth + cz),
    clipOf(-cx, -h, -depth - cz),
    clipOf(cx, -h, -depth + cz),
  ].flat();
  return plateMetrics(
    corners,
    clipOf(0, 0, -depth),
    VIEW_W,
    VIEW_H,
    272,
    108,
    16,
    22,
  );
}

describe("plateMetrics for any depth and turn", () => {
  const depth = fc.double({ min: 2, max: 30, noNaN: true });

  it("falls as one over the depth for a facing plate", () => {
    fc.assert(
      fc.property(depth, depth, (a, b) => {
        expect(plateAt(a, 0).letterPx * a).toBeCloseTo(
          plateAt(b, 0).letterPx * b,
          6,
        );
      }),
    );
  });

  it("never reads a turned plate wider than tall, and its line is the letter's share", () => {
    fc.assert(
      fc.property(
        depth,
        fc.double({ min: 0.001, max: (80 * Math.PI) / 180, noNaN: true }),
        (d, yaw) => {
          const m = plateAt(d, yaw);
          expect(m.letterPxW).toBeLessThanOrEqual(m.letterPxH + 1e-9);
          expect(m.letterPx).toBe(m.letterPxW);
          expect(m.linePx).toBeCloseTo((m.letterPx * 22) / 16, 9);
        },
      ),
    );
  });
});

describe("easeInOutCubic for any two times", () => {
  it("is monotone, with its ends fixed", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(easeInOutCubic(lo)).toBeLessThanOrEqual(easeInOutCubic(hi));
          expect(easeInOutCubic(lo)).toBeGreaterThanOrEqual(0);
          expect(easeInOutCubic(hi)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});
