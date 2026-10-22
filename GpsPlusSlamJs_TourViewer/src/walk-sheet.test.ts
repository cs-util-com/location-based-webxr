import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  focusAfterTap,
  focusLostToHiding,
  hideKeepingFocus,
  quickKind,
  rowsDrawKey,
  rowTapOf,
  setArrow,
  sheetAfterDrag,
  WALK_SHEET_DRAG_PX,
} from "./walk-sheet";
import type { WalkRow } from "./walk-sheet-model";

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

describe("setArrow (the direction arrows, W4 build plan M3)", () => {
  // Why: an arrow's angle moves with every camera frame; it must turn in
  // place and write its style only when the whole degree changed, and an
  // arrow without an angle (no heading, no distance shown) is hidden.
  function arrow() {
    let writes = 0;
    const style = {
      get transform() {
        return this._t;
      },
      set transform(v: string) {
        writes += 1;
        this._t = v;
      },
      _t: "",
    };
    return {
      el: { dataset: {} as DOMStringMap, style } as unknown as Pick<
        SVGElement,
        "dataset" | "style"
      >,
      writes: () => writes,
    };
  }

  it("turns to the angle, writes once per change, and hides on null", () => {
    const a = arrow();
    setArrow(a.el, 62);
    expect(a.el.dataset["deg"]).toBe("62");
    expect(a.el.style.transform).toBe("rotate(62deg)");
    setArrow(a.el, 62);
    expect(a.writes()).toBe(1);
    setArrow(a.el, -170);
    // The short way round: 128 degrees on from 62.
    expect(a.el.dataset["deg"]).toBe("-170");
    expect(a.el.style.transform).toBe("rotate(190deg)");
    setArrow(a.el, null);
    expect(a.el.dataset["deg"]).toBeUndefined();
    expect(a.el.style.transform).toBe("");
    setArrow(a.el, null);
    expect(a.writes()).toBe(3);
    // Shown again, it starts at its angle.
    setArrow(a.el, -170);
    expect(a.el.style.transform).toBe("rotate(-170deg)");
  });

  // Why this test matters: the arrow eases between angles (a CSS
  // transition on its transform), and an angle that crosses straight
  // behind (170 to -170) would spin it 340 degrees the long way round
  // for a 20 degree turn of the visitor.
  it("turns the short way across straight behind", () => {
    const a = arrow();
    setArrow(a.el, 170);
    setArrow(a.el, -170);
    expect(a.el.style.transform).toBe("rotate(190deg)");
    setArrow(a.el, 170);
    expect(a.el.style.transform).toBe("rotate(170deg)");
  });

  it("every step turns at most half a turn, to an angle equal to the one asked modulo 360", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -180, max: 180 }), {
          minLength: 1,
          maxLength: 40,
        }),
        (angles) => {
          const a = arrow();
          let previous: number | null = null;
          for (const deg of angles) {
            setArrow(a.el, deg);
            const turned = Number(
              /^rotate\((-?[\d.]+)deg\)$/.exec(a.el.style.transform)?.[1],
            );
            expect((((turned - deg) % 360) + 360) % 360).toBe(0);
            expect(Math.abs(turned - (previous ?? turned))).toBeLessThanOrEqual(
              180,
            );
            previous = turned;
          }
        },
      ),
    );
  });
});

describe("the rows' controls (W4 build plan M4, §1.6)", () => {
  const row = (over: Partial<WalkRow> = {}): WalkRow => ({
    id: "well",
    number: 2,
    title: "The well",
    state: "next",
    sub: "46 m",
    arrowDeg: 10,
    action: { kind: "skip", label: "Skip", ariaLabel: "Skip The well" },
    confirm: null,
    undoLeftMs: null,
    chosen: false,
    choosable: true,
    mainLabel: "The well: 46 m. Guide me here",
    ...over,
  });

  // Why: the sheet redraws on every camera frame; a redraw rebuilds the
  // rows' buttons, restarts the undo's bar and moves the focus. The arrow
  // and the undo's time left change every frame, so they must not redraw
  // the rows - while the undo appearing or going, or any text, must.
  it("the redraw key ignores the arrow and the undo's time left, not the undo itself", () => {
    const undo = row({
      action: { kind: "undo", label: "Undo", ariaLabel: "Undo" },
      undoLeftMs: 5_000,
    });
    expect(rowsDrawKey([row({ arrowDeg: 80 })])).toBe(rowsDrawKey([row()]));
    expect(rowsDrawKey([{ ...undo, undoLeftMs: 120 }])).toBe(
      rowsDrawKey([undo]),
    );
    expect(rowsDrawKey([{ ...undo, undoLeftMs: null }])).not.toBe(
      rowsDrawKey([undo]),
    );
    expect(rowsDrawKey([row({ sub: "47 m" })])).not.toBe(rowsDrawKey([row()]));
    expect(rowsDrawKey([row({ chosen: true })])).not.toBe(rowsDrawKey([row()]));
  });

  it("a control's data-tap is the guide's row tap; the undo is a bring back", () => {
    for (const tap of ["skip", "confirm", "cancel", "bring", "choose"]) {
      expect(rowTapOf(tap)).toBe(tap);
    }
    expect(rowTapOf("undo")).toBe("bring");
    expect(rowTapOf(undefined)).toBeNull();
    expect(rowTapOf("end")).toBeNull();
  });

  // Why: the tapped control is rebuilt (or gone) after its tap; a keyboard
  // or switch user's focus must land on what took its place - the confirm
  // after Skip, the undo after the confirm, Skip again after Cancel or a
  // bring back - never on the page's body.
  it("the focus after a tap goes to what took the control's place", () => {
    expect(focusAfterTap("skip")[0]).toBe("confirm");
    expect(focusAfterTap("confirm")[0]).toBe("undo");
    expect(focusAfterTap("cancel")).toEqual(["skip"]);
    expect(focusAfterTap("undo")[0]).toBe("skip");
    expect(focusAfterTap("bring")[0]).toBe("skip");
    expect(focusAfterTap("choose")).toEqual(["choose"]);
  });
});
