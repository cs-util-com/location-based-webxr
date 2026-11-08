import { describe, expect, it } from "vitest";

import { stableNudge, unit } from "./stable-jitter.js";

describe("stableNudge", () => {
  // Why this test matters: the skeleton roof moves every footprint corner by
  // this nudge so no two walls are exactly parallel. If it changed between
  // runs, a city would re-roof itself on every rebuild; if it ignored one
  // quadrant, nudges would push every corner the same way and leave the very
  // parallels it exists to break.
  it("is a pure function of its key", () => {
    expect(stableNudge("a/0/1")).toEqual(stableNudge("a/0/1"));
    expect(stableNudge("a/0/1")).not.toEqual(stableNudge("a/0/2"));
  });

  it("stays inside [-1, 1) on both axes and reaches all four quadrants", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { x, y } = stableNudge(`key-${i}`);
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(y).toBeLessThan(1);
      seen.add(`${Math.sign(x)}${Math.sign(y)}`);
    }
    expect(seen.size).toBe(4);
  });

  it("draws its axes from salts no other helper uses", () => {
    // A nudge equal to the tree yaw or the POI scale of the same key would tie
    // two unrelated variations together.
    const key = "way/1";
    const { x, y } = stableNudge(key);
    expect((x + 1) / 2).not.toBe(unit(key, "r"));
    expect((y + 1) / 2).not.toBe(unit(key, "s"));
    expect(x).not.toBe(y);
  });
});
