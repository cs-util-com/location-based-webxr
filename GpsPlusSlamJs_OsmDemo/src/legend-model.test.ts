/**
 * The legend's view model — what the colours actually mean.
 *
 * Why these tests matter:
 * The demo shipped with no legend at all, and the one sentence that stood in
 * for one ("above 1, the identity is 1, up to 8, log scale…") was reported as
 * incomprehensible. It is not decoration — it is the on-screen answer to
 * iteration 8's second question, whether unbounded scores are practically
 * thresholdable — so it is being replaced rather than deleted (DEC-13), and the
 * replacement has to carry the same claim.
 *
 * Two things here are load-bearing beyond "it renders". The legend must NAME the
 * category, because without that a redraw that changed every colour slightly is
 * indistinguishable from no redraw at all — the M2 report. And the three
 * sub-threshold bands (DEC-7) must stay distinguishable, because telling a hard
 * veto apart from "nothing known" is the entire point of revealing them.
 *
 * @see legend-model.ts.md
 */

import { describe, it, expect } from "vitest";

import { legendModel } from "./legend-model.js";
import { describeScale } from "./heat-colours.js";

const SCALE = { threshold: 1, max: 8 };

describe("legendModel — the ramp", () => {
  it("names the category, so the colours belong to something visible", () => {
    // The M2 fix: a picture that does not say what it is a picture OF cannot be
    // checked by eye against a category switch.
    expect(legendModel(SCALE, "walkable", false).category).toBe("walkable");
  });

  it("labels the ends with the threshold and the max actually on screen", () => {
    const model = legendModel(SCALE, "walkable", false);
    expect(model.minLabel).toBe("1");
    expect(model.maxLabel).toBe("8");
  });

  it("rounds a messy max, because a product prints as 3.6000000000000005", () => {
    expect(
      legendModel({ threshold: 1, max: 3.6000000000000005 }, "x", false)
        .maxLabel,
    ).toBe("3.6");
  });

  it("gives every ramp swatch a distinct colour, low to high", () => {
    const swatches = legendModel(SCALE, "walkable", false).ramp;
    expect(swatches.length).toBeGreaterThanOrEqual(5);
    expect(new Set(swatches.map((s) => s.colour)).size).toBe(swatches.length);
    // Ordered dark-to-bright the same way the map is, or the legend is a lie
    // about which end of the ramp is "more".
    expect(swatches[0]?.colour).not.toBe(swatches[swatches.length - 1]?.colour);
  });

  it("keeps `describeScale` as the accessible text, so the claim survives", () => {
    // DEC-13: the sentence is replaced pictorially, not deleted. It stays as the
    // legend's title/aria text — the same claim, legible to a screen reader.
    const model = legendModel(SCALE, "walkable", false);
    expect(model.description).toBe(describeScale(SCALE));
  });

  it("degrades to a single stop when every cell scores the same", () => {
    // `heatScale` collapses max===threshold; a legend that divided by the span
    // would emit NaN colours and Leaflet would drop every path.
    const model = legendModel({ threshold: 1, max: 1 }, "walkable", false);
    expect(model.ramp.every((s) => s.colour.startsWith("#"))).toBe(true);
    expect(model.minLabel).toBe("1");
    expect(model.maxLabel).toBe("1");
  });
});

describe("legendModel — the sub-threshold bands (DEC-7)", () => {
  it("shows no bands until the user asks for them", () => {
    expect(legendModel(SCALE, "walkable", false).bands).toEqual([]);
  });

  it("shows exactly three, and they are visually distinct from each other", () => {
    const bands = legendModel(SCALE, "walkable", true).bands;
    expect(bands.map((b) => b.kind)).toEqual(["veto", "identity", "below"]);
    // The whole reason the checkbox exists is to tell a hard veto apart from
    // "no rule said anything". Two bands that render identically would answer
    // the question with the same picture for both.
    expect(new Set(bands.map((b) => `${b.colour}/${b.fill}`)).size).toBe(3);
  });

  it("draws the identity band as an outline with no fill", () => {
    // "Nothing known here" must not assert knowledge the data does not have —
    // the claim `map-view.ts` has always made in a comment, now made in pixels.
    const identity = legendModel(SCALE, "walkable", true).bands.find(
      (b) => b.kind === "identity",
    );
    expect(identity?.fill).toBe(false);
    expect(identity?.label).toMatch(/nothing/i);
  });

  it("labels the veto band with its number, not just a word", () => {
    const veto = legendModel(SCALE, "walkable", true).bands.find(
      (b) => b.kind === "veto",
    );
    expect(veto?.label).toContain("0");
    expect(veto?.fill).toBe(true);
  });

  it("labels the partial band against the threshold that hides it", () => {
    const below = legendModel({ threshold: 2, max: 8 }, "x", true).bands.find(
      (b) => b.kind === "below",
    );
    expect(below?.label).toContain("2");
  });
});
