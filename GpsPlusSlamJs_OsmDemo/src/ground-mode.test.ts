/**
 * The ground mode — five states enumerating strategy x appearance (W6, DEC-R5-4).
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

  it("defaults to the CPU path WITH the ramp (DEC-R5-4)", () => {
    // The owner's call, and it overrides DEC-R4-5's "the height ramp stays off by
    // default". CPU because that is the existing default strategy, so this
    // changes exactly one thing.
    expect(DEFAULT_GROUND_MODE).toBe("cpu-ramp");
  });
});

describe("the two axes stay independent", () => {
  it("offers every combination of strategy and appearance", () => {
    // The five-way form IS the decision (DEC-R5-4). Enumerating the combinations
    // is what keeps the CPU/GPU comparison reachable while the ramp is on.
    expect([...GROUND_MODES]).toEqual([
      "cpu",
      "cpu-ramp",
      "gpu",
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

  it("covers both appearances for both strategies", () => {
    // The guard against someone "simplifying" the list back to four entries.
    for (const strategy of ["cpu", "gpu"] as const) {
      const forStrategy = GROUND_MODES.filter(
        (mode) => groundStrategy(mode) === strategy,
      );
      expect(forStrategy.map(groundShowsRamp).sort()).toEqual([false, true]);
    }
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
