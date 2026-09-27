/**
 * The `?qrperf` size section (QR size consensus plan §7-§8, S2).
 *
 * Why these tests matter: the owner wants to see, per run, whether the
 * code's size from parallax and its size from depth agree, and a flag when
 * they part by a 2x-class margin - log only, nothing acts on it yet. The
 * parallax size assumes a still code, so a window read while the code was
 * turning must be counted apart and never enter the numbers (test E on
 * r744 moved the code most of the run, plan §79), and a refused window
 * (no scale) must not either.
 */
import { describe, expect, it } from "vitest";
import { createSizeTally, sizeLines } from "./size-tally.js";

const estimated = (cm: number) => ({
  status: "estimated",
  estimateM: cm / 100,
});

describe("createSizeTally", () => {
  it("summarizes the parallax sizes and the depth size, and their ratio", () => {
    const t = createSizeTally();
    for (const cm of [15.8, 16.1, 16.0, 15.9, 16.3]) {
      t.add({
        parallax: { sizeM: cm / 100, lateralBaselineM: 0.1, views: 8 },
        turning: false,
        depth: estimated(17.6),
      });
    }
    const s = t.summary();
    expect(s.parallax.windows).toBe(5);
    expect(s.parallax.p50Cm).toBeCloseTo(16.0, 6);
    expect(s.depth.latestCm).toBeCloseTo(17.6, 6);
    expect(s.depth.status).toBe("estimated");
    expect(s.ratio).toBeCloseTo(16.0 / 17.6, 6);
    expect(s.conflict).toBe(false);
  });

  it("keeps turning and refused windows out of the numbers, and counts them", () => {
    const t = createSizeTally();
    t.add({
      parallax: { sizeM: 0.5, lateralBaselineM: 0.1, views: 8 },
      turning: true,
      depth: estimated(16),
    });
    t.add({ parallax: null, turning: false, depth: estimated(16) });
    t.add({
      parallax: { sizeM: 0.16, lateralBaselineM: 0.1, views: 8 },
      turning: false,
      depth: estimated(16),
    });
    const s = t.summary();
    expect(s.parallax.windows).toBe(1);
    expect(s.parallax.skippedTurning).toBe(1);
    expect(s.parallax.refused).toBe(1);
    expect(s.parallax.p50Cm).toBeCloseTo(16, 6);
  });

  // Plan §7: a 2x-class disagreement (over 25 %) is flagged, either way.
  it("flags a conflict when the two sizes part by more than 25 %", () => {
    for (const [depthCm, conflict] of [
      [16, false],
      [21, true],
      [12, true],
    ] as const) {
      const t = createSizeTally();
      t.add({
        parallax: { sizeM: 0.16, lateralBaselineM: 0.1, views: 8 },
        turning: false,
        depth: estimated(depthCm),
      });
      expect(t.summary().conflict, `depth ${depthCm}`).toBe(conflict);
    }
  });

  it("tracks the depth size's range while it reads estimated", () => {
    const t = createSizeTally();
    for (const cm of [15.4, 18.6, 15.9])
      t.add({ parallax: null, turning: false, depth: estimated(cm) });
    t.add({
      parallax: null,
      turning: false,
      depth: { status: "measuring", estimateM: 0.3 },
    });
    const s = t.summary();
    expect(s.depth.estimatedMinCm).toBeCloseTo(15.4, 6);
    expect(s.depth.estimatedMaxCm).toBeCloseTo(18.6, 6);
    expect(s.depth.latestCm).toBeCloseTo(30, 6);
    expect(s.ratio).toBeNull();
    expect(s.conflict).toBe(false);
  });

  it("renders a line a screenshot can carry", () => {
    const t = createSizeTally();
    t.add({
      parallax: { sizeM: 0.16, lateralBaselineM: 0.12, views: 8 },
      turning: false,
      depth: estimated(17.6),
    });
    expect(sizeLines(t.summary())).toEqual([
      "size: parallax p50 16.0 cm [16.0, 16.0] (1 windows, baseline p50 12.0 cm; 0 refused, 0 while turning) | depth 17.6 cm estimated (range 17.6-17.6) | ratio 0.91",
    ]);
  });

  it("says when there is nothing yet", () => {
    expect(sizeLines(createSizeTally().summary())).toEqual([
      "size: parallax - (0 windows, baseline p50 - cm; 0 refused, 0 while turning) | depth - | ratio -",
    ]);
  });
});
