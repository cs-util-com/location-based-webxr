// @vitest-environment jsdom
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  SHORT_WINDOW_MAX_H,
  placeToasts,
  toastSpot,
  type Rect,
} from "./toast-spot.js";

/** A phone held sideways, as the editor lays it out: the tree docked at
 *  the left, the inspector at the right, the map controls at the view's
 *  foot left of the inspector. */
const WIN = { width: 844, height: 390 };
const VIEW: Rect = { left: 210, right: 576, top: 40, bottom: 366 };
const CONTROLS: Rect = { left: 442, right: 564, top: 314, bottom: 352 };

describe("toastSpot", () => {
  it("puts the toasts in a short window at the view's foot, left of the map controls", () => {
    // Why: there the view is too short for the toasts' usual place, half
    // way up the window, which is where the selection's gizmo stands - a
    // toast over it took the press meant for it. The view's bottom-left
    // corner, beside the map controls, is clear of what the view frames.
    expect(toastSpot(VIEW, CONTROLS, WIN)).toEqual({
      left: 222,
      right: WIN.width - (442 - 8),
      bottom: WIN.height - 352,
    });
  });

  it("stands level with the map controls wherever they sit at the foot", () => {
    // Why: the controls rise over an open bottom panel; the toasts beside
    // them rise with them rather than standing under the panel.
    const raised: Rect = { left: 442, right: 564, top: 302, bottom: 340 };
    expect(toastSpot(VIEW, raised, WIN)?.bottom).toBe(WIN.height - 340);
  });

  it("keeps the usual place in a window tall enough", () => {
    // Why: there the toasts stand over the map controls row, well below
    // the view's middle, as they always did.
    expect(
      toastSpot(VIEW, CONTROLS, { width: 844, height: SHORT_WINDOW_MAX_H + 1 }),
    ).toBeNull();
    expect(
      toastSpot(VIEW, CONTROLS, { width: 844, height: SHORT_WINDOW_MAX_H }),
    ).not.toBeNull();
  });

  it("reaches to the view's right edge when the map controls stand elsewhere or not at all", () => {
    // Why: on a narrow screen the map controls stand at the view's top
    // right; at the foot nothing then limits the toasts but the view.
    const top: Rect = { left: 600, right: 720, top: 52, bottom: 90 };
    const wide = { left: 0, right: 740, top: 40, bottom: 366 };
    const at = { width: 740, height: 390 };
    expect(toastSpot(wide, top, at)).toEqual({
      left: 12,
      right: 740 - (740 - 12),
      bottom: 390 - (366 - 14),
    });
    expect(toastSpot(wide, null, at)).toEqual(toastSpot(wide, top, at));
    // Shown nowhere: an empty box.
    const hidden: Rect = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(toastSpot(wide, hidden, at)).toEqual(toastSpot(wide, null, at));
  });

  it("keeps the usual place when there is no view, or no room beside the controls", () => {
    // Why: a toast squeezed into a sliver would stand taller than the
    // view; the usual place is then the lesser harm.
    expect(toastSpot(null, CONTROLS, WIN)).toBeNull();
    expect(
      toastSpot({ left: 0, right: 0, top: 0, bottom: 0 }, null, WIN),
    ).toBeNull();
    // A view with no height (folded away) is none, however wide.
    expect(
      toastSpot({ left: 0, right: 740, top: 200, bottom: 200 }, null, WIN),
    ).toBeNull();
    const narrow: Rect = { left: 300, right: 576, top: 40, bottom: 366 };
    expect(toastSpot(narrow, CONTROLS, WIN)).toBeNull();
  });

  it("stands inside the view and clear of the map controls, wherever they are", () => {
    // Why: the rule must hold for any docking, not the one layout above.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 100, max: 1200 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 120, max: 560 }),
        fc.integer({ min: 0, max: 300 }),
        (left, width, top, height, gap) => {
          const win = { width: left + width + 300, height: top + height };
          const view = { left, right: left + width, top, bottom: top + height };
          const controls = {
            left: view.right - 12 - 122 - gap,
            right: view.right - 12 - gap,
            top: view.bottom - 52,
            bottom: view.bottom - 14,
          };
          const spot = toastSpot(view, controls, win);
          if (spot === null) return;
          const l = spot.left;
          const r = win.width - spot.right;
          const b = win.height - spot.bottom;
          expect(l).toBeGreaterThanOrEqual(view.left);
          expect(r).toBeLessThanOrEqual(view.right);
          expect(r).toBeLessThanOrEqual(controls.left);
          expect(r - l).toBeGreaterThanOrEqual(160);
          expect(b).toBeLessThanOrEqual(view.bottom);
          expect(b).toBeGreaterThan(view.top);
        },
      ),
    );
  });
});

describe("placeToasts", () => {
  it("stands the toasts at the spot and marks them, and gives the usual place back", () => {
    // Why: the spot is written on the element itself, so the next toast
    // in a tall window must take it away again, or the toasts would stay
    // squeezed into a corner after the window grew.
    const el = document.createElement("div");
    placeToasts(el, { left: 222, right: 410, bottom: 38 });
    expect(el.classList.contains("in-view")).toBe(true);
    expect(el.style.left).toBe("222px");
    expect(el.style.right).toBe("410px");
    expect(el.style.bottom).toBe("38px");
    placeToasts(el, null);
    expect(el.classList.contains("in-view")).toBe(false);
    expect(el.style.left).toBe("");
    expect(el.style.right).toBe("");
    expect(el.style.bottom).toBe("");
  });
});
