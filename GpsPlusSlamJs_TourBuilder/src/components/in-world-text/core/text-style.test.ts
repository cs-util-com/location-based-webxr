import { describe, expect, it } from "vitest";

import { DEFAULT_TEXT_STYLE, resolveTextStyle } from "./text-style.js";
import { PAGE_PANEL_LAYOUT } from "./page-layout.js";

describe("resolveTextStyle", () => {
  const resolved = resolveTextStyle(DEFAULT_TEXT_STYLE);

  it("keeps a 4:3 texture and derives the plane size from maxWidthMeters", () => {
    expect(resolved.canvasW).toBe(1024);
    expect(resolved.canvasH).toBe(768);
    expect(resolved.planeW).toBeCloseTo(0.6, 6);
    expect(resolved.planeH).toBeCloseTo(0.6 * (768 / 1024), 6);
  });

  it("wraps slightly narrower than the text rect (safety margin)", () => {
    expect(resolved.wrapWidthPx).toBeCloseTo(
      PAGE_PANEL_LAYOUT.text.w * 1024 * 0.95,
      6,
    );
  });

  it("derives maxLinesPerPage from the text-rect height / line height", () => {
    const rectHeightPx = PAGE_PANEL_LAYOUT.text.h * 768;
    expect(resolved.maxLinesPerPage).toBe(
      Math.floor(rectHeightPx / DEFAULT_TEXT_STYLE.lineHeightPx),
    );
    expect(resolved.maxLinesPerPage).toBeGreaterThanOrEqual(1);
  });

  it("ignores maxHeightMeters when lineCount is not given", () => {
    const withCap = resolveTextStyle({
      ...DEFAULT_TEXT_STYLE,
      maxHeightMeters: 1.8,
    });
    expect(withCap.planeH).toBeCloseTo(resolved.planeH, 6);
    expect(withCap.canvasH).toBe(768);
  });
});

describe("resolveTextStyle with dynamic height (maxHeightMeters + lineCount)", () => {
  const maxHeightMeters = 1.8;
  const floorPlaneH = DEFAULT_TEXT_STYLE.maxWidthMeters * (768 / 1024);

  it("stays at the fixed-aspect floor when the content already fits", () => {
    const resolved = resolveTextStyle(
      { ...DEFAULT_TEXT_STYLE, maxHeightMeters },
      1,
    );
    expect(resolved.planeH).toBeCloseTo(floorPlaneH, 6);
    expect(resolved.canvasH).toBe(768);
  });

  it("grows past the floor to fit more lines, without exceeding the cap", () => {
    const resolved = resolveTextStyle(
      { ...DEFAULT_TEXT_STYLE, maxHeightMeters },
      6,
    );
    expect(resolved.planeH).toBeGreaterThan(floorPlaneH);
    expect(resolved.planeH).toBeLessThan(maxHeightMeters);
    // Pixel density along Y matches X (within integer-pixel rounding), so
    // growing the panel never visibly stretches the text/buttons.
    const densityY = resolved.canvasH / resolved.planeH;
    const densityX = resolved.canvasW / resolved.planeW;
    expect(Math.abs(densityY - densityX) / densityX).toBeLessThan(0.01);
    // The panel grew enough to fit every line on one page.
    expect(resolved.maxLinesPerPage).toBeGreaterThanOrEqual(6);
  });

  it("clamps at maxHeightMeters when the content needs more room than that", () => {
    const resolved = resolveTextStyle(
      { ...DEFAULT_TEXT_STYLE, maxHeightMeters },
      500,
    );
    expect(resolved.planeH).toBeCloseTo(maxHeightMeters, 6);
    // Still short of fitting everything — pagination handles the remainder.
    expect(resolved.maxLinesPerPage).toBeLessThan(500);
  });
});

describe("resolveTextStyle with minHeightMeters", () => {
  const minHeightMeters = 1.8;
  const floorPlaneH = DEFAULT_TEXT_STYLE.maxWidthMeters * (768 / 1024);

  it("raises the panel to the minimum even for a one-line text", () => {
    const resolved = resolveTextStyle(
      { ...DEFAULT_TEXT_STYLE, minHeightMeters, maxHeightMeters: 2.5 },
      1,
    );
    expect(resolved.planeH).toBeCloseTo(minHeightMeters, 6);
    expect(resolved.floorPlaneH).toBeCloseTo(floorPlaneH, 6);
    // The extra height goes to the text rect, so more lines fit per page.
    expect(resolved.maxLinesPerPage).toBeGreaterThan(
      resolveTextStyle({ ...DEFAULT_TEXT_STYLE }).maxLinesPerPage,
    );
  });

  it("applies without lineCount or maxHeightMeters", () => {
    const resolved = resolveTextStyle({
      ...DEFAULT_TEXT_STYLE,
      minHeightMeters,
    });
    expect(resolved.planeH).toBeCloseTo(minHeightMeters, 6);
  });

  it("still grows past the minimum for long text, up to maxHeightMeters", () => {
    const resolved = resolveTextStyle(
      { ...DEFAULT_TEXT_STYLE, minHeightMeters: 0.9, maxHeightMeters: 1.8 },
      500,
    );
    expect(resolved.planeH).toBeCloseTo(1.8, 6);
  });

  it("lets maxHeightMeters win when it is below the minimum", () => {
    const resolved = resolveTextStyle(
      { ...DEFAULT_TEXT_STYLE, minHeightMeters: 2, maxHeightMeters: 1.2 },
      1,
    );
    expect(resolved.planeH).toBeCloseTo(1.2, 6);
  });
});
