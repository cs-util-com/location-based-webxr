import { describe, expect, it } from "vitest";

import { toStatsView } from "./stats-view.js";

/**
 * Why these tests matter: the stats panel is the demo's whole point — it is
 * what makes "streaming, not downloading" VISIBLE. A percentage that renders
 * NaN, exceeds 100, or divides by a zero archive size would undermine the
 * claim the panel exists to demonstrate.
 */

const STATS = {
  origin: "network" as const,
  networkRequests: 9,
  networkBytes: 10_638,
  cacheReads: 4,
  cacheBytes: 2_048,
};

describe("toStatsView", () => {
  it("renders fetched-vs-total with a bounded percentage", () => {
    const view = toStatsView(STATS, 88_642, "network");
    expect(view.headline).toContain("of");
    expect(view.headline).toContain("(12.0%)");
    expect(view.detail).toBe(
      "9 range requests · 4 cache reads · serving from network",
    );
  });

  it("never renders NaN or >100% (zero-size archive, over-fetch)", () => {
    expect(toStatsView(STATS, 0, "cache").headline).toContain("(0.0%)");
    expect(
      toStatsView({ ...STATS, networkBytes: 999_999 }, 100, "network").headline,
    ).toContain("(100.0%)");
  });
});
