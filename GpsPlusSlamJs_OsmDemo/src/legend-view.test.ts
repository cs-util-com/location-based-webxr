// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fixedScale } from "./heat-colours.js";
import { LegendView } from "./legend-view.js";

function rendered(
  aboveThresholdCount: number,
  showBelow: boolean,
): HTMLElement {
  const container = document.createElement("div");
  new LegendView({ container }).render(fixedScale(4), "park", showBelow, {
    aboveThresholdCount,
    observedMax: 1,
  });
  return container;
}

describe("LegendView", () => {
  // Why this test matters: a category nothing qualifies for used to draw seven
  // identical swatches between two labels both reading "1". The sentence has to
  // REPLACE the ramp, and the bands stay because that is when someone asks what
  // is actually there.
  it("says so instead of drawing a ramp when no cell clears the bar", () => {
    const legend = rendered(0, true);

    expect(legend.querySelector(".legend-empty")?.textContent).toContain(
      "no cell scores above",
    );
    expect(legend.querySelector(".legend-strip")).toBeNull();
    expect(legend.querySelector(".legend-min")).toBeNull();
    expect(legend.querySelectorAll(".legend-band")).toHaveLength(3);
  });

  it("draws the ramp, and no empty sentence, when cells clear the bar", () => {
    const legend = rendered(5, false);

    expect(legend.querySelector(".legend-empty")).toBeNull();
    expect(legend.querySelector(".legend-strip")).not.toBeNull();
    expect(legend.querySelector(".legend-min")).not.toBeNull();
  });
});
