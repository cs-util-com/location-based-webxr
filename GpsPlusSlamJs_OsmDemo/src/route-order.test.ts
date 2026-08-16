/**
 * Why this test matters: DEC-R3 turns a confident lie into motion. Before it, a
 * click in the far half of the drawn 2 400 m scene reported "the agent cannot
 * reach that spot" — untrue; the search had simply run out of expansions at
 * ~374–529 m. The clamp is the whole fix, so its edge cases are the fix's edge
 * cases: preserve the direction, never lengthen an order, and never invent a
 * position for a destination that is not a position.
 */

import { describe, expect, it } from "vitest";

import { clampOrder, MAX_ORDER_M } from "./route-order.js";

const HOME = { lat: 50.9413, lng: 6.9583 };
const M_PER_DEG_LAT = 111_320;

/** Metres between two points, in the same approximation the module uses. */
function metresBetween(a: typeof HOME, b: typeof HOME): number {
  const cosLat = Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(
    (b.lng - a.lng) * M_PER_DEG_LAT * cosLat,
    (b.lat - a.lat) * M_PER_DEG_LAT,
  );
}

/** A destination `metres` due north of HOME. */
const north = (metres: number) => ({
  lat: HOME.lat + metres / M_PER_DEG_LAT,
  lng: HOME.lng,
});

describe("clampOrder", () => {
  it("leaves a reachable order exactly alone", () => {
    const to = north(100);
    const order = clampOrder(HOME, to);
    expect(order.clamped).toBe(false);
    // The SAME object semantics matter: an untouched order must not acquire
    // floating-point drift from a round trip it did not need.
    expect(order.to).toEqual(to);
  });

  it("shortens a far order to the limit", () => {
    const order = clampOrder(HOME, north(2_000));
    expect(order.clamped).toBe(true);
    expect(metresBetween(HOME, order.to)).toBeCloseTo(MAX_ORDER_M, 0);
  });

  it("preserves the direction it was pointed in", () => {
    // Sending the agent somewhere other than toward the click is a different
    // order, not a shortened one. Checked on a diagonal, where a bug that
    // clamped the axes independently would show as a bearing change.
    const far = { lat: HOME.lat + 0.02, lng: HOME.lng + 0.03 };
    const order = clampOrder(HOME, far);

    const bearing = (p: typeof HOME) =>
      Math.atan2(p.lng - HOME.lng, p.lat - HOME.lat);
    expect(bearing(order.to)).toBeCloseTo(bearing(far), 10);
    expect(metresBetween(HOME, order.to)).toBeCloseTo(MAX_ORDER_M, 0);
  });

  it("never lengthens an order", () => {
    for (const metres of [0, 1, 50, MAX_ORDER_M - 1, MAX_ORDER_M]) {
      const to = north(metres);
      const order = clampOrder(HOME, to);
      expect(metresBetween(HOME, order.to)).toBeLessThanOrEqual(
        Math.max(metres, 1e-6) + 1e-6,
      );
      expect(order.clamped).toBe(false);
    }
  });

  it("passes a degenerate destination through rather than inventing one", () => {
    // A NaN destination is an upstream fault. Clamping it would produce a
    // plausible position and hide the fault; passing it through lets the failure
    // stay visible where it belongs.
    const nan = { lat: Number.NaN, lng: HOME.lng };
    expect(clampOrder(HOME, nan)).toEqual({ to: nan, clamped: false });

    // Ordering the agent to where it already stands is not a clamp either.
    expect(clampOrder(HOME, HOME)).toEqual({ to: HOME, clamped: false });
  });

  it("takes an explicit limit, so the reach can be tested independently", () => {
    const order = clampOrder(HOME, north(500), 50);
    expect(order.clamped).toBe(true);
    expect(metresBetween(HOME, order.to)).toBeCloseTo(50, 0);
  });

  it("keeps the limit inside the search's pessimistic reach", () => {
    // The constant is only defensible against the number it was derived from:
    // ~374 m at two standable levels per cell. If someone raises it toward the
    // optimistic 529 m, this fails and asks them to re-measure rather than
    // letting far clicks quietly start refusing again.
    expect(MAX_ORDER_M).toBeLessThan(374);
  });
});
