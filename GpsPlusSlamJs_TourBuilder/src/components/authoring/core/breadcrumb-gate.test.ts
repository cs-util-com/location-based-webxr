import { describe, expect, it } from "vitest";

import {
  MAX_FIX_ACCURACY_M,
  MAX_JUMP_WITHOUT_TIMESTAMP_M,
  MAX_WALK_SPEED_MPS,
  REANCHOR_FIX_COUNT,
  REANCHOR_RADIUS_M,
  createBreadcrumbGate,
} from "./breadcrumb-gate.js";

/**
 * Why this matters: the sampler alone only compares each fix with the last
 * RECORDED one, so a device whose fix jumps A -> B -> A -> B (a stationary
 * desktop, or indoors) records every jump, piling breadcrumbs onto the same
 * two spots. The gate decides whether a fix is believable enough to record at
 * all, and how it recovers when the trail legitimately jumps (tunnel, GPS
 * dropout, a bad first point).
 */

const ORIGIN = { lat: 50.7753, lon: 6.0839 };

/** ~1 degree of latitude is ~111,320 m; small deltas approximate meters. */
function metersNorth(base: { lat: number; lon: number }, meters: number) {
  return { lat: base.lat + meters / 111_320, lon: base.lon };
}

describe("createBreadcrumbGate — accuracy", () => {
  it("records the first fix", () => {
    expect(createBreadcrumbGate().consider(ORIGIN)).toBe(true);
  });

  it("rejects a fix whose reported accuracy is worse than the limit", () => {
    const gate = createBreadcrumbGate();
    expect(gate.consider(ORIGIN, { accuracy: MAX_FIX_ACCURACY_M + 1 })).toBe(
      false,
    );
  });

  it("accepts a fix exactly at the accuracy limit", () => {
    const gate = createBreadcrumbGate();
    expect(gate.consider(ORIGIN, { accuracy: MAX_FIX_ACCURACY_M })).toBe(true);
  });

  it("does not gate on accuracy when the source reports none", () => {
    expect(createBreadcrumbGate().consider(ORIGIN, {})).toBe(true);
  });

  it("a rejected inaccurate first fix does not become the anchor", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN, { accuracy: 500 });
    // Still the first believable fix, so it is recorded wherever it is.
    expect(gate.consider(metersNorth(ORIGIN, 500), { accuracy: 5 })).toBe(true);
  });
});

describe("createBreadcrumbGate — minimum spacing", () => {
  it("still applies the sampler's minimum distance from the last recorded point", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    expect(gate.consider(metersNorth(ORIGIN, 2))).toBe(false);
  });
});

describe("createBreadcrumbGate — jump without timestamps", () => {
  it("accepts a move inside the fallback jump limit", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    expect(
      gate.consider(metersNorth(ORIGIN, MAX_JUMP_WITHOUT_TIMESTAMP_M - 5)),
    ).toBe(true);
  });

  it("rejects a move past the fallback jump limit", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    expect(
      gate.consider(metersNorth(ORIGIN, MAX_JUMP_WITHOUT_TIMESTAMP_M + 5)),
    ).toBe(false);
  });
});

describe("createBreadcrumbGate — implied speed with timestamps", () => {
  it("accepts a walking-pace move", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN, { timestamp: 0 });
    // 12 m in 4 s = 3 m/s.
    expect(gate.consider(metersNorth(ORIGIN, 12), { timestamp: 4_000 })).toBe(
      true,
    );
  });

  it("rejects a teleport: the same 12 m in 1 s is far above walking speed", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN, { timestamp: 0 });
    expect(12 / 1).toBeGreaterThan(MAX_WALK_SPEED_MPS);
    expect(gate.consider(metersNorth(ORIGIN, 12), { timestamp: 1_000 })).toBe(
      false,
    );
  });

  it("judges by speed, not distance: 100 m over a minute is fine (long pause, tunnel exit)", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN, { timestamp: 0 });
    expect(gate.consider(metersNorth(ORIGIN, 100), { timestamp: 60_000 })).toBe(
      true,
    );
  });

  it("falls back to the distance limit when the timestamps do not advance", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN, { timestamp: 5_000 });
    expect(gate.consider(metersNorth(ORIGIN, 30), { timestamp: 5_000 })).toBe(
      false,
    );
  });
});

describe("createBreadcrumbGate — reanchor (waypoint dropped at live GPS)", () => {
  it("makes the next fix near the new anchor believable even though it is far from the old one", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    const tunnelExit = metersNorth(ORIGIN, 300);
    gate.reanchor(tunnelExit);

    expect(gate.consider(metersNorth(tunnelExit, 6))).toBe(true);
  });

  it("without a reanchor the same far fix stays rejected", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    const tunnelExit = metersNorth(ORIGIN, 300);

    expect(gate.consider(metersNorth(tunnelExit, 6))).toBe(false);
  });

  it("uses the reanchor timestamp for the speed check", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN, { timestamp: 0 });
    const tunnelExit = metersNorth(ORIGIN, 300);
    gate.reanchor(tunnelExit, { timestamp: 100_000 });

    // 6 m in 2 s = 3 m/s from the new anchor: believable.
    expect(
      gate.consider(metersNorth(tunnelExit, 6), { timestamp: 102_000 }),
    ).toBe(true);
  });
});

describe("createBreadcrumbGate — self-healing without a waypoint", () => {
  const far = (offsetM: number) => metersNorth(ORIGIN, 500 + offsetM);

  it(`accepts a new anchor once ${REANCHOR_FIX_COUNT} rejected fixes in a row agree with each other`, () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);

    expect(gate.consider(far(0))).toBe(false);
    expect(gate.consider(far(1))).toBe(false);
    expect(gate.consider(far(2))).toBe(true);
  });

  it("keeps recording normally from the healed anchor", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    gate.consider(far(0));
    gate.consider(far(1));
    gate.consider(far(2));

    expect(gate.consider(far(10))).toBe(true);
  });

  it(`heals when the rejected fixes spread up to REANCHOR_RADIUS_M apart`, () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    const edge = REANCHOR_RADIUS_M - 0.5; // clear of the boundary, not on it

    expect(gate.consider(far(0))).toBe(false);
    expect(gate.consider(far(edge / 2))).toBe(false);
    expect(gate.consider(far(edge))).toBe(true);
  });

  it(`does not heal once the rejected fixes spread past REANCHOR_RADIUS_M`, () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    const beyond = REANCHOR_RADIUS_M + 5; // clear of the boundary, not on it

    expect(gate.consider(far(0))).toBe(false);
    expect(gate.consider(far(beyond / 2))).toBe(false);
    expect(gate.consider(far(beyond))).toBe(false);
  });

  it("never heals on A -> B -> A -> B jitter: the rejected fixes do not agree", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    const b = metersNorth(ORIGIN, 40);
    const c = metersNorth(ORIGIN, 80);

    // B and C are both far from the anchor and from each other.
    const results = [b, c, b, c, b, c].map((p) => gate.consider(p));
    expect(results).not.toContain(true);
  });

  it("a fix back near the anchor confirms it and clears the rejected streak", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    gate.consider(far(0));
    gate.consider(far(1));
    gate.consider(metersNorth(ORIGIN, 1)); // near the anchor: anchor confirmed

    expect(gate.consider(far(2))).toBe(false);
    expect(gate.consider(far(3))).toBe(false);
  });

  it("inaccurate fixes do not count toward healing", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);

    const results = [far(0), far(1), far(2)].map((p) =>
      gate.consider(p, { accuracy: 80 }),
    );
    expect(results).toEqual([false, false, false]);
  });

  it("an accepted fix clears the rejected streak", () => {
    const gate = createBreadcrumbGate();
    gate.consider(ORIGIN);
    gate.consider(far(0));
    gate.consider(far(1));
    gate.consider(metersNorth(ORIGIN, 10)); // believable move: accepted

    // Only one rejected fix is on record again, not three.
    expect(gate.consider(far(2))).toBe(false);
  });
});
