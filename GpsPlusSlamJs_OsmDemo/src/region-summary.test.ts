import { describe, expect, it } from "vitest";

import { summariseRegion, type SummarisableRegion } from "./region-summary.js";

/**
 * WHY THESE TESTS MATTER (DEC-R7b-3a, DEC-R7b-11). A testing session found a
 * region painted as "10" sitting over cells scoring 288 and asked why the
 * picture did not say so. The spread was already computed — `Region` has carried
 * `minScore` and `maxScore` since it was written — and thrown away at the UI.
 *
 * So the panel's whole job is to say the thing the colour cannot, and the ways
 * that can go wrong are all arithmetic or wording: a twelve-digit score printed
 * in full (round 7 shipped exactly that in the legend), "1 cells", or a spread
 * note that fires on every region and therefore means nothing.
 */
const region = (
  over: Partial<SummarisableRegion> = {},
): SummarisableRegion => ({
  id: "r1",
  category: "walkable",
  cellCount: 12,
  areaM2: 526,
  medianScore: 10,
  minScore: 4,
  maxScore: 288,
  ...over,
});

describe("summariseRegion", () => {
  it("titles the panel with the category, so two regions are not confusable", () => {
    expect(summariseRegion(region()).title).toBe("walkable region");
  });

  it("shows the median AND the range, which is the finding", () => {
    const { stats } = summariseRegion(region());
    expect(stats.find((s) => s.label === "median")?.value).toBe("10");
    expect(stats.find((s) => s.label === "range")?.value).toBe("4 – 288");
  });

  it("calls out a spread the colour hides", () => {
    // The session's own numbers: median 10, peak 288.
    const note = summariseRegion(region()).spreadNote;
    expect(note).toContain("288");
    expect(note).toContain("median");
  });

  it("stays quiet when the region is uniform", () => {
    // A note on every region is the same as no note. The scores are a PRODUCT of
    // rule factors spanning twelve orders of magnitude, so a 2x spread inside
    // one region is unremarkable.
    expect(
      summariseRegion(region({ maxScore: 18 })).spreadNote,
    ).toBeUndefined();
  });

  it("abbreviates a huge score instead of printing it in full", () => {
    // Round 7 shipped `1 … 27992463056732.17` in the legend because a second
    // copy of the rounding existed. This goes through the same `formatScore`, so
    // a third copy cannot appear here.
    const { stats } = summariseRegion(region({ maxScore: 2.8e13 }));
    expect(stats.find((s) => s.label === "range")?.value).not.toContain(
      "27992463056732",
    );
  });

  it("says 'cell' rather than '1 cells'", () => {
    const { stats } = summariseRegion(region({ cellCount: 1 }));
    expect(stats.find((s) => s.label === "cells")?.value).toBe("1 cell");
  });

  it("scales the area to a unit a human reads", () => {
    expect(
      summariseRegion(region({ areaM2: 526 })).stats.find(
        (s) => s.label === "area",
      )?.value,
    ).toBe("526 m²");
    expect(
      summariseRegion(region({ areaM2: 52_600 })).stats.find(
        (s) => s.label === "area",
      )?.value,
    ).toBe("5.26 ha");
    expect(
      summariseRegion(region({ areaM2: 5_260_000 })).stats.find(
        (s) => s.label === "area",
      )?.value,
    ).toBe("5.26 km²");
  });

  it("survives a non-finite score without printing 'Infinity'", () => {
    // Defensive: `heatScale` filters these, but a panel reading "Infinity" looks
    // like a broken demo rather than a broken input.
    const summary = summariseRegion(
      region({ maxScore: Number.POSITIVE_INFINITY }),
    );
    expect(summary.spreadNote).toBeUndefined();
    const range =
      summary.stats.find((stat) => stat.label === "range")?.value ?? "";
    expect(range).toContain("—");
    // Explicitly, because the em dash standing in for the non-finite value and
    // the en dash separating the pair are DIFFERENT characters: a range that
    // had leaked the word through would still satisfy toContain("—").
    expect(range).not.toContain("Infinity");
  });
});
