/**
 * Height resolution against messy tagging (§5, DEC-R6-12).
 *
 * The S3DB resolution as a whole is exercised through `buildings.test.ts` and
 * the fixture corpus. This file exists for the one case round 6 found broken,
 * and keeps it isolated so the fix cannot quietly be lost inside a larger suite.
 */

import { describe, expect, it } from "vitest";

import { resolveHeights } from "./building-heights.js";

/**
 * `min_height` reconciled against the building's own height (§5, DEC-R6-12).
 *
 * PORTED FROM streets-gl's `getBuildingParamsFromOSMTags`, which is the one item
 * of §5 that genuinely IS a port — and the port is narrower than it looks. Most
 * of that function derives `building:levels`, which this package does not model
 * at all, so what transfers is the reconciliation between `min_height` and the
 * total: `minHeight = min(minLevel * levelHeight, height)`.
 *
 * WHY IT MATTERS, measured on this code before the change:
 *
 *   { height: "10", min_height: "100" }
 *     -> minHeightM 100, totalHeightM 100
 *   { height: "10", "building:min_level": "30" }
 *     -> minHeightM 90, totalHeightM 90
 *
 * Both are a ZERO-HEIGHT volume floating a hundred metres up, and in both the
 * tagged `height=10` — the one thing the mapper definitely meant — was silently
 * discarded. The old code raised the TOTAL to meet the base; the fix clamps the
 * BASE to fit under the total, which is the only direction that keeps a
 * mistyped tag from inventing a skyscraper.
 *
 * This is ordinary OSM messiness rather than an exotic case: `min_height` and
 * `building:min_level` are hand-entered on parts of large buildings, and a
 * transposed digit is the common failure.
 */
describe("min_height against a tagged height", () => {
  it("keeps the tagged height when min_height exceeds it", () => {
    // The building is 10 m. It must stay 10 m.
    const heights = resolveHeights({
      building: "yes",
      height: "10",
      min_height: "100",
    });
    expect(heights.totalHeightM).toBeCloseTo(10, 6);
  });

  it("never produces a zero-height volume from a bad min_height", () => {
    // A wall of no height renders as nothing, so the building silently
    // disappears — worse than drawing it wrong, because there is nothing to see
    // and question.
    const heights = resolveHeights({
      building: "yes",
      height: "10",
      min_height: "100",
    });
    expect(heights.totalHeightM - heights.minHeightM).toBeGreaterThan(0);
  });

  it("does the same for an absurd building:min_level", () => {
    // The other spelling of the same mistake. 30 levels at 3 m is 90 m, on a
    // 10 m building.
    const heights = resolveHeights({
      building: "yes",
      height: "10",
      "building:min_level": "30",
    });
    expect(heights.totalHeightM).toBeCloseTo(10, 6);
    expect(heights.totalHeightM - heights.minHeightM).toBeGreaterThan(0);
  });

  it("leaves a SENSIBLE min_height completely alone", () => {
    // The regression guard, and the reason the clamp is conditional rather than
    // universal: an upper `building:part` starting at 20 m of a 60 m tower is
    // the schema working exactly as intended, and this is most of what
    // `min_height` is for.
    const heights = resolveHeights({
      "building:part": "yes",
      height: "60",
      min_height: "20",
    });
    expect(heights.minHeightM).toBeCloseTo(20, 6);
    expect(heights.totalHeightM).toBeCloseTo(60, 6);
  });

  it("still lets min_height raise an UNTAGGED building's total", () => {
    // With no `height` there is nothing to contradict, so the base is the only
    // evidence about scale and the old behaviour is right: a part starting at
    // 30 m is at least 30 m tall. Clamping here would flatten it to the default.
    const heights = resolveHeights({
      "building:part": "yes",
      min_height: "30",
    });
    expect(heights.totalHeightM).toBeGreaterThan(30);
  });
});
