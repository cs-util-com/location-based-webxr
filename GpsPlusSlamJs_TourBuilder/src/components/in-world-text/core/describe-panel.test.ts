import { describe, expect, it } from "vitest";

import { describePanel } from "./describe-panel.js";
import { DEFAULT_TEXT_STYLE, resolveTextStyle } from "./text-style.js";

const style = resolveTextStyle(DEFAULT_TEXT_STYLE);

describe("describePanel", () => {
  it("lays out one DrawLine per page line, stepping by lineHeightPx", () => {
    const model = describePanel(["one", "two", "three"], style, {
      canPrev: false,
      canNext: true,
      label: "1 / 3",
    });
    expect(model.lines).toHaveLength(3);
    const [first, second] = model.lines;
    expect(first?.text).toBe("one");
    // All lines share the same left x; y advances by exactly one line height.
    expect(second?.xPx).toBeCloseTo(first?.xPx ?? -1, 6);
    expect((second?.yPx ?? 0) - (first?.yPx ?? 0)).toBeCloseTo(
      style.lineHeightPx,
      6,
    );
  });

  it("carries the nav enabled flags and the indicator label", () => {
    const model = describePanel(["x"], style, {
      canPrev: false,
      canNext: true,
      label: "1 / 4",
    });
    expect(model.prev.enabled).toBe(false);
    expect(model.next.enabled).toBe(true);
    expect(model.indicator.text).toBe("1 / 4");
  });

  it("renders chrome for an empty page (buttons + indicator, no lines)", () => {
    const model = describePanel([], style, {
      canPrev: false,
      canNext: false,
      label: "1 / 1",
    });
    expect(model.lines).toHaveLength(0);
    expect(model.prev.rectPx.w).toBeGreaterThan(0);
    expect(model.next.rectPx.w).toBeGreaterThan(0);
  });
});
