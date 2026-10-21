import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  focusLostToHiding,
  hideKeepingFocus,
  quickKind,
  sheetAfterDrag,
  WALK_SHEET_DRAG_PX,
} from "./walk-sheet";

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

describe("hideKeepingFocus (W4 build plan M2 review)", () => {
  // Why: a keyboard or switch user's focus sits on "Keep listening" when
  // it hides, or inside the story card when the card closes; a hidden
  // focused element drops focus to the page's body, and the visitor starts
  // over from the top. The focus moves to what takes its place.
  function el(hidden: boolean) {
    const node = {
      hidden,
      focused: 0,
      contains: (other: unknown) => other === node || other === child,
      focus: () => {
        node.focused += 1;
      },
    };
    const child = { inside: true };
    return { node, child };
  }

  it("moves the focus to the fallback when the element that holds it hides", () => {
    const keep = el(false);
    const end = el(false);
    hideKeepingFocus(keep.node, true, end.node, keep.node);
    expect(keep.node.hidden).toBe(true);
    expect(end.node.focused).toBe(1);
    const card = el(false);
    const grab = el(false);
    hideKeepingFocus(card.node, true, grab.node, card.child);
    expect(grab.node.focused).toBe(1);
  });

  it("leaves the focus alone elsewhere, when showing, and when already hidden", () => {
    const keep = el(false);
    const end = el(false);
    hideKeepingFocus(keep.node, true, end.node, { elsewhere: true });
    expect(keep.node.hidden).toBe(true);
    hideKeepingFocus(keep.node, true, end.node, keep.node);
    hideKeepingFocus(keep.node, false, end.node, keep.node);
    expect(keep.node.hidden).toBe(false);
    hideKeepingFocus(keep.node, true, end.node, null);
    expect(end.node.focused).toBe(0);
  });
});

describe("focusLostToHiding (W4 build plan M2 review)", () => {
  // Why: a browser blurs a focused control the moment it is hidden, before
  // the sheet hides the card around it (the guide hides the story's end
  // control first), so the sheet cannot see the focus at its own hide; it
  // catches the loss itself. Only a loss to NOWHERE because the control
  // (or a parent) hid counts: a tab to another control, or the window
  // losing focus while the control still shows, must not move it.
  const node = (hidden: boolean, hiddenParent = false, connected = true) => ({
    hidden,
    isConnected: connected,
    closest: (selector: string) =>
      selector === "[hidden]" && (hidden || hiddenParent) ? {} : null,
  });

  it("counts a loss to nowhere from a control that hid, itself or by a parent, or left the page", () => {
    expect(focusLostToHiding(node(true), null)).toBe(true);
    expect(focusLostToHiding(node(false, true), null)).toBe(true);
    expect(focusLostToHiding(node(false, false, false), null)).toBe(true);
  });

  it("ignores a move to another control and a window blur over a control still shown", () => {
    expect(focusLostToHiding(node(true), { id: "other" })).toBe(false);
    expect(focusLostToHiding(node(false), null)).toBe(false);
    expect(focusLostToHiding(null, null)).toBe(false);
  });
});
