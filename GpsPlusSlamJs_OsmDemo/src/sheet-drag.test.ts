/**
 * The mobile map sheet's height, as a number.
 *
 * Why these tests matter:
 * On a phone each view got half the height and the 3D pane was a letterbox.
 * The fix (DEC-10) makes the 3D view full-bleed with the map as a draggable
 * sheet over it — which is also the whole of D8's "let me resize the areas",
 * without a splitter. The part that goes wrong in a drag is the clamp: dragged
 * to either extreme, one of the two views disappears entirely and there is no
 * longer a handle to drag back, so the app is stuck until reload.
 *
 * @see sheet-drag.ts.md
 */

import { describe, it, expect } from "vitest";

import {
  clampSheetHeight,
  MAX_SHEET_FRACTION,
  MIN_SHEET_FRACTION,
} from "./sheet-drag.js";

describe("clampSheetHeight", () => {
  it("keeps a normal drag exactly where it was put", () => {
    expect(clampSheetHeight(0.5)).toBeCloseTo(0.5, 10);
  });

  it("never lets either view vanish", () => {
    // The failure this exists to prevent: drag the sheet to the bottom and the
    // map is gone along with the handle that would bring it back.
    expect(clampSheetHeight(0)).toBe(MIN_SHEET_FRACTION);
    expect(clampSheetHeight(1)).toBe(MAX_SHEET_FRACTION);
    expect(clampSheetHeight(-5)).toBe(MIN_SHEET_FRACTION);
    expect(clampSheetHeight(99)).toBe(MAX_SHEET_FRACTION);
  });

  it("leaves room for both views at both limits", () => {
    expect(MIN_SHEET_FRACTION).toBeGreaterThan(0);
    expect(MAX_SHEET_FRACTION).toBeLessThan(1);
    expect(MIN_SHEET_FRACTION).toBeLessThan(MAX_SHEET_FRACTION);
  });

  it("is total over nonsense input, because a pointer event can carry anything", () => {
    // A NaN height would set `height: NaN%`, which the browser ignores — the
    // sheet would silently stop responding with no error anywhere.
    expect(clampSheetHeight(Number.NaN)).toBe(MIN_SHEET_FRACTION);
    expect(clampSheetHeight(Number.POSITIVE_INFINITY)).toBe(MAX_SHEET_FRACTION);
  });
});
