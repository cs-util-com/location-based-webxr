import { describe, expect, it, vi } from "vitest";

import type { EnuPoint } from "./enu.js";
import { planInventedRoofs, type InventedFootprint } from "./invented-roofs.js";
import type * as RoofSkeleton from "./roof-skeleton.js";
import { SkeletonFailure } from "./roof-skeleton.js";

/**
 * Which skeleton errors a plan absorbs. The skeleton is replaced here by a
 * stub that throws what the test asks for, so this lives in its own file:
 * the mock would otherwise replace it for every planner test.
 *
 * Why this test matters: a refused ring (`SkeletonFailure`) is an expected
 * outcome and gives a lid; any other error is a defect in the skeleton or
 * the planner. A defect must not fail the whole plan (one house would fail
 * the city and the obstacle index), and it must not pass silently either
 * (every such bug would become plain buildings no one notices): that house
 * gets no plan, and `onDefect` hears of it once.
 */

const thrown: { error: Error | undefined } = { error: undefined };

vi.mock("./roof-skeleton.js", async (original) => {
  const actual = await original<typeof RoofSkeleton>();
  return {
    ...actual,
    skeletonRoof: (...args: Parameters<typeof actual.skeletonRoof>) => {
      if (thrown.error !== undefined) throw thrown.error;
      return actual.skeletonRoof(...args);
    },
  };
});

function house(): InventedFootprint {
  const ring: EnuPoint[] = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 8 },
    { x: 0, y: 8 },
  ];
  return {
    key: "way/1",
    tags: { building: "house" },
    at: { x: 6, y: 4 },
    polygons: [[ring]],
    hasParts: false,
  };
}

describe("planInventedRoofs, skeleton errors", () => {
  it("gives a lid, not a roof, when the skeleton refuses the ring", () => {
    thrown.error = new SkeletonFailure("parallel walls");
    try {
      const plan = planInventedRoofs([house()]).get(house().key);
      expect(plan?.kind).not.toBe("roof");
    } finally {
      thrown.error = undefined;
    }
  });

  it("reports any other error once and leaves only that house without a plan", () => {
    const defect = new TypeError("a defect");
    thrown.error = defect;
    const onDefect = vi.fn();
    try {
      const plans = planInventedRoofs([house()], { onDefect });
      expect(plans.has(house().key)).toBe(false);
      expect(onDefect).toHaveBeenCalledTimes(1);
      expect(onDefect).toHaveBeenCalledWith(defect);
    } finally {
      thrown.error = undefined;
    }
  });

  it("reports nothing for a refused ring", () => {
    thrown.error = new SkeletonFailure("parallel walls");
    const onDefect = vi.fn();
    try {
      planInventedRoofs([house()], { onDefect });
      expect(onDefect).not.toHaveBeenCalled();
    } finally {
      thrown.error = undefined;
    }
  });

  it("plans a roof with the real skeleton (the stub is transparent)", () => {
    expect(planInventedRoofs([house()]).get(house().key)?.kind).toBe("roof");
  });
});
