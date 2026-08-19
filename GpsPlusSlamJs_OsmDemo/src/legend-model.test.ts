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

import { classifyScore, legendModel } from "./legend-model.js";
import { describeScale, fixedScale } from "./heat-colours.js";

/**
 * What the DATA does, for tests that are about the RAMP rather than the data.
 *
 * Non-degenerate on purpose: `legendModel` keys its "nothing here" message on
 * `aboveThresholdCount` now (DEC-H7), so a zero here would put every test below
 * into the empty state.
 */
const SOME_DATA = { aboveThresholdCount: 12, observedMax: 8 };

/**
 * No cell clears the bar — the R3-8 case.
 *
 * KEYED ON THE COUNT, not on a degenerate scale. `max <= threshold` used to
 * mean this, and it only worked because the max was observed; under a fixed
 * ramp it can never be true again, so the fix would have died silently and its
 * e2e stayed green.
 */
const NOTHING_HERE = { aboveThresholdCount: 0, observedMax: 1 };

const SCALE = { threshold: 1, max: 8 };

describe("legendModel — the ramp", () => {
  it("names the category, so the colours belong to something visible", () => {
    // The M2 fix: a picture that does not say what it is a picture OF cannot be
    // checked by eye against a category switch.
    expect(legendModel(SCALE, "walkable", false, SOME_DATA).category).toBe(
      "walkable",
    );
  });

  it("labels the ends with the threshold and the max actually on screen", () => {
    const model = legendModel(SCALE, "walkable", false, SOME_DATA);
    expect(model.minLabel).toBe("1");
    expect(model.maxLabel).toBe("8");
  });

  it("rounds a messy max, because a product prints as 3.6000000000000005", () => {
    expect(
      legendModel(
        { threshold: 1, max: 3.6000000000000005 },
        "x",
        false,
        SOME_DATA,
      ).maxLabel,
    ).toBe("3.6");
  });

  it("abbreviates a huge max — THIS is the number the session actually saw", () => {
    // DEC-R6b-6. The sixth session reported "von 1 bis" followed by a very long
    // number, from a screenshot reading `walkable 1 … 27992463056732.17`.
    //
    // WHY THIS TEST IS HERE AND NOT ONLY IN `heat-colours.test.ts`: the visible
    // strip is `maxLabel`, built here. `describeScale` is only the strip's title
    // and screen-reader text. Fixing the formatter in `heat-colours.ts` alone
    // would have abbreviated the tooltip and left the number on screen exactly
    // as reported — which is why this file had its own `round` and why that copy
    // is now gone.
    expect(
      legendModel(
        { threshold: 1, max: 27992463056732.17 },
        "walkable",
        false,
        SOME_DATA,
      ).maxLabel,
    ).toBe("2.8e13");
  });

  it("uses ONE formatter for the label and the description", () => {
    // The duplicate `round` in this file is what let the two drift apart. They
    // are now the same function, and this pins that rather than the coincidence
    // that both currently abbreviate.
    const model = legendModel(
      { threshold: 1, max: 1.4e12 },
      "walkable",
      false,
      SOME_DATA,
    );
    expect(model.maxLabel).toBe("1.4e12");
    expect(model.description).toContain("1.4e12");
  });

  it("spells a readable threshold out in the empty-state message", () => {
    // DEC-U8, 2026-08-19. This used to assert `2.5e5`, because every endpoint
    // was abbreviated alike. The owner asked for the ramp's numbers to be
    // written out, and 250 000 is comfortably readable — the exponential form
    // was protecting against twelve digits, not six.
    //
    // EMPTY IS NOW A COUNT (DEC-H7). The scale can no longer be degenerate, so
    // nothing-here has to be said by the data rather than inferred from a
    // collapsed ramp.
    const model = legendModel(fixedScale(250000), "x", false, NOTHING_HERE);
    expect(model.emptyMessage).toContain("250 000");
    expect(model.emptyMessage).not.toContain("2.5e5");
  });

  it("STILL abbreviates a threshold that would print without bound", () => {
    // The half of DEC-R6b-6 that survives DEC-U8, and the reason the spell-out
    // is a threshold rather than unconditional. `scaleFor` falls back to
    // `threshold * 10` once a threshold reaches the cap, so a rule table with a
    // high threshold can put a ten-digit number on this label — which is the
    // defect DEC-R6b-6 removed, on the one screen where there is nothing else
    // to look at.
    const model = legendModel(fixedScale(2.5e9), "x", false, NOTHING_HERE);
    expect(model.emptyMessage).toContain("2.5e9");
  });

  it("reports what the DATA reaches, not just where the ramp ends", () => {
    // THE COMPENSATING HALF OF DEC-H7, and it was asserted nowhere until the
    // r513 review said so. `heat-colours.ts.md` accepts saturating ~10-14 % of
    // `walkable` explicitly on the grounds that "the legend compensates, and
    // has to" — so this is the assertion that claim rests on. Wiring
    // `observedLabel` to `maxLabel`, or deleting the span from the view, kept
    // every test green.
    //
    // The two must be able to DIFFER: `maxLabel` is the fixed cap and is the
    // same everywhere, `observedLabel` is what is on screen here.
    const model = legendModel(fixedScale(1), "walkable", false, {
      aboveThresholdCount: 40,
      observedMax: 512.4,
    });

    expect(model.observedLabel).toBe("512.4");
    expect(model.maxLabel).not.toBe(model.observedLabel);
    expect(model.aboveThresholdCount).toBe(40);
  });

  it("reports a saturating field differently from a flat one", () => {
    // WHY THE READOUT EXISTS AT ALL. On a clipped ramp both look identical —
    // every cell at the yellow end. The observed max is the only thing that
    // separates "everything here is off the top of the scale" from "everything
    // here is merely at it".
    const saturating = legendModel(fixedScale(1), "walkable", false, {
      aboveThresholdCount: 900,
      observedMax: 3e17,
    });
    const flat = legendModel(fixedScale(1), "walkable", false, {
      aboveThresholdCount: 900,
      observedMax: 1e4,
    });

    expect(saturating.observedLabel).not.toBe(flat.observedLabel);
  });

  it("gives every ramp swatch a distinct colour, low to high", () => {
    const swatches = legendModel(SCALE, "walkable", false, SOME_DATA).ramp;
    expect(swatches.length).toBeGreaterThanOrEqual(5);
    expect(new Set(swatches.map((s) => s.colour)).size).toBe(swatches.length);
    // Ordered dark-to-bright the same way the map is, or the legend is a lie
    // about which end of the ramp is "more".
    expect(swatches[0]?.colour).not.toBe(swatches[swatches.length - 1]?.colour);
  });

  it("keeps `describeScale` as the accessible text, so the claim survives", () => {
    // DEC-13: the sentence is replaced pictorially, not deleted. It stays as the
    // legend's title/aria text — the same claim, legible to a screen reader.
    const model = legendModel(SCALE, "walkable", false, SOME_DATA);
    expect(model.description).toBe(describeScale(SCALE));
  });

  it("degrades to a single stop when every cell scores the same", () => {
    // `heatScale` collapses max===threshold; a legend that divided by the span
    // would emit NaN colours and Leaflet would drop every path.
    const model = legendModel(
      { threshold: 1, max: 1 },
      "walkable",
      false,
      SOME_DATA,
    );
    expect(model.ramp.every((s) => s.colour.startsWith("#"))).toBe(true);
    expect(model.minLabel).toBe("1");
    expect(model.maxLabel).toBe("1");
  });
});

describe("classifyScore — which band a cell belongs to", () => {
  it("separates the three sub-threshold cases at the default threshold of 1", () => {
    // Where the old single `score <= threshold` skip threw away the
    // distinction: at threshold 1, a hard veto and "no rule said anything" were
    // both simply not drawn, so the cemetery cell the owner wanted to
    // interrogate was precisely the one that could not be clicked.
    expect(classifyScore(0, 1)).toBe("veto");
    expect(classifyScore(1, 1)).toBe("identity");
    expect(classifyScore(0.5, 1)).toBe("below");
    expect(classifyScore(1.0001, 1)).toBe("ramp");
  });

  it("keeps the identity distinct when the threshold is raised above it", () => {
    // With threshold 2, a score of exactly 1 is BOTH the identity and below the
    // bar. The identity reading wins: "no rule said anything" is a stronger
    // statement about the data than "it scored 1, which is under 2".
    expect(classifyScore(1, 2)).toBe("identity");
    expect(classifyScore(1.5, 2)).toBe("below");
    expect(classifyScore(2, 2)).toBe("below");
    expect(classifyScore(2.5, 2)).toBe("ramp");
  });

  it("is total: a non-finite score lands in the band that asserts least", () => {
    // The map asks this for every cell it draws. A score with no band would be
    // a cell with no fill — an invisible hole rather than a visible error.
    expect(classifyScore(Number.NaN, 1)).toBe("identity");
    expect(classifyScore(Number.POSITIVE_INFINITY, 1)).toBe("identity");
  });
});

describe("legendModel — the sub-threshold bands (DEC-7)", () => {
  it("shows no bands until the user asks for them", () => {
    expect(legendModel(SCALE, "walkable", false, SOME_DATA).bands).toEqual([]);
  });

  it("shows exactly three, and they are visually distinct from each other", () => {
    const bands = legendModel(SCALE, "walkable", true, SOME_DATA).bands;
    expect(bands.map((b) => b.kind)).toEqual(["veto", "identity", "below"]);
    // The whole reason the checkbox exists is to tell a hard veto apart from
    // "no rule said anything". Two bands that render identically would answer
    // the question with the same picture for both.
    expect(new Set(bands.map((b) => `${b.colour}/${b.fill}`)).size).toBe(3);
  });

  it("draws the identity band as an outline with no fill", () => {
    // "Nothing known here" must not assert knowledge the data does not have —
    // the claim `map-view.ts` has always made in a comment, now made in pixels.
    const identity = legendModel(SCALE, "walkable", true, SOME_DATA).bands.find(
      (b) => b.kind === "identity",
    );
    expect(identity?.fill).toBe(false);
    expect(identity?.label).toMatch(/nothing/i);
  });

  it("labels the veto band with its number, not just a word", () => {
    const veto = legendModel(SCALE, "walkable", true, SOME_DATA).bands.find(
      (b) => b.kind === "veto",
    );
    expect(veto?.label).toContain("0");
    expect(veto?.fill).toBe(true);
  });

  it("labels the partial band against the threshold that hides it", () => {
    const below = legendModel(
      { threshold: 2, max: 8 },
      "x",
      true,
      SOME_DATA,
    ).bands.find((b) => b.kind === "below");
    expect(below?.label).toContain("2");
  });
});

describe("the empty state (W12, finding R3-8)", () => {
  /**
   * Why these tests matter:
   * The reported bug was that switching to `Spawn Point` showed "1" at BOTH ends
   * of the legend. That is correct output from a degenerate scale — `heatScale`
   * returns `max === threshold` when nothing on screen clears the bar — and it
   * is not the fact, which is that no cell qualifies. Seven identical swatches
   * between two identical labels is a picture that explains nothing.
   */
  it("says so when nothing scores above the bar", () => {
    const model = legendModel(fixedScale(1), "spawnPoint", false, NOTHING_HERE);

    expect(model.emptyMessage).toContain("spawnPoint");
    expect(model.emptyMessage).toContain("1");
  });

  it("is absent as soon as anything DOES clear the bar", () => {
    // The other direction: a legend that claimed emptiness over a real ramp
    // would be worse than the bug.
    expect(
      legendModel({ threshold: 1, max: 1.0001 }, "walkable", false, SOME_DATA)
        .emptyMessage,
    ).toBeUndefined();
  });

  it("still offers the sub-threshold bands, which is when they matter most", () => {
    // "Nothing qualifies" is exactly the moment someone wants to see what IS
    // there — a veto reads very differently from "no rule ever mentioned this".
    const model = legendModel(fixedScale(1), "spawnPoint", true, NOTHING_HERE);

    expect(model.bands).toHaveLength(3);
  });
});
