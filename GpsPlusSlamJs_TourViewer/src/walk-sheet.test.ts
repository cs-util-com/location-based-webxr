import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { quickKind, sheetAfterDrag, WALK_SHEET_DRAG_PX } from "./walk-sheet";

/**
 * Why these tests matter (visitor walk W4 build plan M2, §1.5): the list
 * opens by a tap on the grab or the peek, or by a drag of more than 24 px
 * (W4); a shorter drag is a tap that slipped, and the direction decides
 * open or close. The quick action's look follows what it offers - a
 * suggestion or an undo wraps to its own line (W4) - and the end of a story
 * is the story card's, never the peek's.
 */
describe("sheetAfterDrag", () => {
  it("up past the threshold opens the list, down closes it, a short drag is a tap", () => {
    expect(sheetAfterDrag(-(WALK_SHEET_DRAG_PX + 1))).toBe("list");
    expect(sheetAfterDrag(WALK_SHEET_DRAG_PX + 1)).toBe("peek");
    expect(sheetAfterDrag(-WALK_SHEET_DRAG_PX)).toBeNull();
    expect(sheetAfterDrag(0)).toBeNull();
    expect(sheetAfterDrag(Number.NaN)).toBeNull();
  });

  it("over the swept thresholds (16-40 px) the sign alone decides past it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 16, max: 40 }),
        fc.integer({ min: -400, max: 400 }),
        (threshold, dy) => {
          const result = sheetAfterDrag(dy, threshold);
          const expected =
            Math.abs(dy) <= threshold ? null : dy < 0 ? "list" : "peek";
          expect(result).toBe(expected);
        },
      ),
    );
  });
});

describe("quickKind", () => {
  it("an ask, a suggestion (the labelled skip) or an undo; the story's end is not the peek's", () => {
    expect(quickKind({ kind: "ask-skip", id: "a" })).toBe("ask");
    expect(quickKind({ kind: "skip", id: "a" })).toBe("suggested");
    expect(quickKind({ kind: "undo", id: "a" })).toBe("undo");
    expect(quickKind({ kind: "ask-end", id: "a" })).toBeNull();
    expect(quickKind({ kind: "end", id: "a" })).toBeNull();
    expect(quickKind(null)).toBeNull();
  });
});
