/**
 * The ground mode — SEVEN states enumerating strategy x appearance (W6/§2,
 * DEC-R5-4 then DEC-R6-16).
 *
 * Why these tests matter:
 * This control used to be three states plus a `terrainDebug` layer switch, and
 * folding the ramp into it can go wrong in two silent ways. An unknown value
 * from a URL parameter must not leave the scene with no ground and no
 * explanation — "the ground vanished because of a typo in a query string" is the
 * worst available outcome. And the two AXES must stay independently reachable:
 * a four-way list (CPU / GPU / ramp / none) would make choosing the ramp
 * silently choose a strategy, and the CPU-vs-GPU A/B is the entire reason this
 * picker exists (DEC-R3-3).
 *
 * The retired `terrainDebug` string gets its own test, because the removal is
 * covered by `parseGroundMode`'s existing fallback contract rather than by new
 * migration code — see the plan's W6 for why no migration exists to write.
 *
 * @see ground-mode.ts.md
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_GROUND_MODE,
  GROUND_MODES,
  groundAppearance,
  groundModeLabel,
  groundShowsRamp,
  groundStrategy,
  parseGroundMode,
} from "./ground-mode.js";

describe("parseGroundMode", () => {
  it("accepts every mode the picker offers", () => {
    // Exhaustive over the list rather than over literals, so a sixth mode cannot
    // arrive without being parseable.
    for (const mode of GROUND_MODES) {
      expect(parseGroundMode(mode)).toBe(mode);
    }
  });

  it("falls back to the default for anything else", () => {
    // The store holds this as a plain string (the framework may not name a demo
    // type) and it is a candidate for a URL parameter, so the input is genuinely
    // untrusted.
    expect(parseGroundMode("wireframe")).toBe(DEFAULT_GROUND_MODE);
    expect(parseGroundMode("")).toBe(DEFAULT_GROUND_MODE);
    expect(parseGroundMode(undefined)).toBe(DEFAULT_GROUND_MODE);
  });

  it("falls back for the retired `terrainDebug` value too", () => {
    // The ramp used to be a LAYER. Nothing persists layer state and nothing
    // serialises it into a URL today, so no stored `terrainDebug` can exist —
    // which is exactly why the removal needs no migration, only the fallback
    // that was already there. This test is what says that out loud.
    expect(parseGroundMode("terrainDebug")).toBe(DEFAULT_GROUND_MODE);
  });

  it("defaults to the CPU path WITH the slope treatment (DEC-R6-5)", () => {
    // REVERSES DEC-R5-4, which made the height ramp the default a day earlier,
    // and there is a measurement behind the reversal rather than a preference:
    // §1's DEC-R4-5 gate found that with the ramp on, the ground OUT-SATURATES
    // the affordance grid that constraint exists to protect. The ramp is a
    // deliberately loud blue-to-white scale with magenta for missing DEM, and it
    // was breaching the rule it was supposed to sit beneath.
    //
    // Slope answers R5-2 ("the terrain reads as flat") where the ramp does not:
    // a ramp recolours flat-looking ground, contour lines make the shape
    // legible. CPU because that is still the strategy that shipped.
    expect(DEFAULT_GROUND_MODE).toBe("cpu-slope");
  });
});

describe("the two axes stay independent", () => {
  it("offers every combination of strategy and appearance", () => {
    // The SEVEN-way form is the decision (DEC-R6-16). Enumerating rather than
    // splitting into two pickers is what makes DEC-R3-17 true by construction:
    // there is no "none-slope" entry to choose, so no control can be offered
    // that does nothing.
    expect([...GROUND_MODES]).toEqual([
      "cpu",
      "cpu-slope",
      "cpu-ramp",
      "gpu",
      "gpu-slope",
      "gpu-ramp",
      "none",
    ]);
  });

  it("maps each mode to the displacement path it drives", () => {
    // `building-view` cares about the STRATEGY only: the ramp is a material swap
    // on the same plane. Conflating them would recompile a shader on an
    // appearance change.
    expect(groundStrategy("cpu")).toBe("cpu");
    expect(groundStrategy("cpu-ramp")).toBe("cpu");
    expect(groundStrategy("gpu")).toBe("gpu");
    expect(groundStrategy("gpu-ramp")).toBe("gpu");
    expect(groundStrategy("none")).toBe("none");
  });

  it("maps each mode to whether the ramp material is used", () => {
    expect(groundShowsRamp("cpu")).toBe(false);
    expect(groundShowsRamp("cpu-ramp")).toBe(true);
    expect(groundShowsRamp("gpu")).toBe(false);
    expect(groundShowsRamp("gpu-ramp")).toBe(true);
    expect(groundShowsRamp("none")).toBe(false);
  });

  it("never shows the ramp where there is no ground to colour", () => {
    // DEC-R3-17 used to be enforced by disabling a switch. With the ramp folded
    // into the mode it is satisfied BY CONSTRUCTION — there is no `none-ramp`
    // entry to choose — and this is the assertion that keeps it that way.
    // Filtered rather than branched: an `expect` inside an `if` is green when the
    // condition never holds, which for an exhaustive claim like this is exactly
    // the way it would rot.
    const rampWithNoGround = GROUND_MODES.filter(
      (mode) => groundStrategy(mode) === "none" && groundShowsRamp(mode),
    );
    expect(rampWithNoGround).toEqual([]);
  });

  it("covers all THREE appearances for both displacement strategies", () => {
    // The guard against someone "simplifying" the list back down. Each
    // displacement path must reach plain, slope AND ramp, or the CPU/GPU
    // comparison stops being available under some appearance — the exact trap
    // DEC-R5-4's five-way form was built to avoid, and which a third appearance
    // makes easier to fall into.
    for (const strategy of ["cpu", "gpu"] as const) {
      const forStrategy = GROUND_MODES.filter(
        (mode) => groundStrategy(mode) === strategy,
      );
      expect(forStrategy.map(groundAppearance).sort()).toEqual([
        "plain",
        "ramp",
        "slope",
      ]);
    }
  });

  it("gives the slope treatment to both strategies, not only the CPU one", () => {
    // The shader patch is on the lit material, which both paths share — so a
    // slope entry missing for GPU would mean the treatment silently vanished
    // when someone switched path to measure the A/B.
    expect(groundAppearance("cpu-slope")).toBe("slope");
    expect(groundAppearance("gpu-slope")).toBe("slope");
  });

  it("leaves `none` with no appearance to offer", () => {
    // DEC-R3-17 by construction, restated for the third appearance: "No ground
    // + slope" would be a mode that draws nothing while claiming to do
    // something.
    expect(
      GROUND_MODES.filter((mode) => groundStrategy(mode) === "none"),
    ).toEqual(["none"]);
    expect(groundAppearance("none")).toBe("plain");
  });
});

describe("groundModeLabel", () => {
  it("names every mode distinctly", () => {
    const labels = GROUND_MODES.map(groundModeLabel);
    expect(new Set(labels).size).toBe(GROUND_MODES.length);
  });

  it("names the ramp in the label, since it is no longer a separate switch", () => {
    // The ramp lost its own labelled control. If the picker does not say the
    // word, the feature becomes undiscoverable — which is half of what R5-3 was
    // complaining about in the first place.
    expect(groundModeLabel("cpu-ramp")).toMatch(/ramp/i);
    expect(groundModeLabel("gpu-ramp")).toMatch(/ramp/i);
  });
});
