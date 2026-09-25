import { describe, expect, it } from "vitest";

import {
  computePagePanelLayout,
  hitToPageIntent,
  PAGE_PANEL_LAYOUT,
  paginate,
} from "./page-layout.js";

/** Centre (u,v) of a layout rect. */
const centre = (r: { x: number; y: number; w: number; h: number }) => ({
  u: r.x + r.w / 2,
  v: r.y + r.h / 2,
});

const BOTH = { canPrev: true, canNext: true };

describe("hitToPageIntent", () => {
  it("returns prev for a hit on the Prev button when allowed", () => {
    expect(hitToPageIntent(centre(PAGE_PANEL_LAYOUT.prev), BOTH)).toEqual({
      type: "prev",
    });
  });

  it("returns next for a hit on the Next button when allowed", () => {
    expect(hitToPageIntent(centre(PAGE_PANEL_LAYOUT.next), BOTH)).toEqual({
      type: "next",
    });
  });

  it("ignores a disabled Prev/Next button (dimmed edge)", () => {
    expect(
      hitToPageIntent(centre(PAGE_PANEL_LAYOUT.prev), {
        canPrev: false,
        canNext: true,
      }),
    ).toBeNull();
    expect(
      hitToPageIntent(centre(PAGE_PANEL_LAYOUT.next), {
        canPrev: true,
        canNext: false,
      }),
    ).toBeNull();
  });

  it("returns null for the text area, the indicator, and chrome", () => {
    expect(hitToPageIntent(centre(PAGE_PANEL_LAYOUT.text), BOTH)).toBeNull();
    expect(
      hitToPageIntent(centre(PAGE_PANEL_LAYOUT.indicator), BOTH),
    ).toBeNull();
    expect(hitToPageIntent({ u: 0.5, v: 0.5 }, BOTH)).toBeNull();
  });
});

describe("computePagePanelLayout", () => {
  it("matches PAGE_PANEL_LAYOUT when the panel is at its floor height", () => {
    expect(computePagePanelLayout(1.2, 1.2)).toEqual(PAGE_PANEL_LAYOUT);
  });

  it("keeps the footer/button chrome at a fixed physical size as the panel grows", () => {
    const floorPlaneH = 0.81;
    const grown = computePagePanelLayout(1.8, floorPlaneH);
    // Absolute (metres) button/footer height stay pinned to the floor size,
    // not the grown panel's own height.
    expect(grown.prev.h * 1.8).toBeCloseTo(
      PAGE_PANEL_LAYOUT.prev.h * floorPlaneH,
      6,
    );
    expect((1 - grown.text.h) * 1.8).toBeCloseTo(
      (1 - PAGE_PANEL_LAYOUT.text.h) * floorPlaneH,
      6,
    );
    // As a fraction of the (now taller) panel, the chrome is smaller.
    expect(grown.prev.h).toBeLessThan(PAGE_PANEL_LAYOUT.prev.h);
  });

  it("centres the buttons vertically within the footer band", () => {
    const grown = computePagePanelLayout(1.8, 0.81);
    const footerTop = grown.text.y; // bottom of the text rect == top of the footer band
    const gapBelow = grown.prev.y;
    const gapAbove = footerTop - (grown.prev.y + grown.prev.h);
    expect(gapAbove).toBeCloseTo(gapBelow, 6);
  });
});

describe("paginate", () => {
  it("chunks lines into pages of at most linesPerPage", () => {
    expect(paginate(["a", "b", "c", "d", "e"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });

  it("fills whole pages when evenly divisible", () => {
    expect(paginate(["a", "b", "c", "d"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns a single empty page for empty input", () => {
    expect(paginate([], 3)).toEqual([[]]);
  });

  it("returns a single page when there are fewer lines than a page", () => {
    expect(paginate(["only", "two"], 8)).toEqual([["only", "two"]]);
  });

  it("throws when linesPerPage is < 1", () => {
    expect(() => paginate(["a"], 0)).toThrow();
  });
});
