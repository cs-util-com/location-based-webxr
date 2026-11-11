import { describe, expect, it } from "vitest";

import { CUT_SETTINGS } from "./cut-settings.js";
import { blankImage } from "./rgba-image.js";
import { alignFrames, composeSheet } from "./sheet-align.js";
import { extents } from "./sheet-check.js";
import { cutBackground, findFigures } from "./sheet-cut.js";
import { syntheticSheet } from "./test-support/synthetic-sheet.js";

const S = CUT_SETTINGS;

// Why these tests matter: the visitor's side trusts the canonical sheet's
// equal cells and common baseline; a pose standing higher than the others,
// or pushed off centre by the beckoning arm, would make the figure hop.
describe("alignFrames", () => {
  const sheet = syntheticSheet({ width: 800, height: 520, noise: 2 });
  const cut = cutBackground(sheet.image, S);
  const { runs } = findFigures(cut.alpha, 800, 520, S);
  const { frames, scale } = alignFrames(cut, 800, 520, runs, S);
  const ext = frames.map(extents);

  it("makes four cells of the canonical size", () => {
    expect(frames).toHaveLength(4);
    for (const f of frames) {
      expect([f.width, f.height]).toEqual([S.cellW, S.cellH]);
    }
    expect(scale).toBeGreaterThan(0);
  });

  it("stands every pose on one baseline near the cell's bottom", () => {
    const baseline = Math.round(S.cellH * 0.96);
    for (const e of ext) {
      expect(Math.abs(e.bottom - (baseline - 1))).toBeLessThanOrEqual(1);
    }
  });

  it("centres each pose by its legs, so the beckoning arm does not push it", () => {
    const idle = ext[0]!;
    const beckon = ext[3]!;
    expect(Math.abs((idle.left + idle.right) / 2 - S.cellW / 2)).toBeLessThan(
      4,
    );
    expect(Math.abs(beckon.left - idle.left)).toBeLessThan(4);
    expect(beckon.right).toBeGreaterThan(idle.right + 20);
  });

  it("scales all four by one factor, to the cell's height or width limit", () => {
    const tallest = Math.max(...ext.map((e) => e.bottom - e.top + 1));
    const widestHalf = Math.max(
      ...ext.map((e) =>
        Math.max(S.cellW / 2 - e.left, e.right + 1 - S.cellW / 2),
      ),
    );
    expect(tallest).toBeLessThanOrEqual(0.92 * S.cellH + 2);
    expect(widestHalf).toBeLessThanOrEqual(0.47 * S.cellW + 2);
    const fillsHeight = Math.abs(tallest - 0.92 * S.cellH) < 4;
    const fillsWidth = Math.abs(widestHalf - 0.47 * S.cellW) < 4;
    expect(fillsHeight || fillsWidth).toBe(true);
  });
});

describe("composeSheet", () => {
  it("lays the cells side by side", () => {
    const cells = [0, 1, 2].map((i) => {
      const c = blankImage(2, 2);
      c.data.fill(i * 50 + 10);
      return c;
    });
    const sheet = composeSheet(cells);
    expect([sheet.width, sheet.height]).toEqual([6, 2]);
    expect(sheet.data[0]).toBe(10);
    expect(sheet.data[2 * 4]).toBe(60);
    expect(sheet.data[(6 + 5) * 4]).toBe(110);
  });

  it("refuses frames of different sizes and an empty list", () => {
    expect(() => composeSheet([])).toThrow();
    expect(() => composeSheet([blankImage(2, 2), blankImage(3, 2)])).toThrow();
  });
});
