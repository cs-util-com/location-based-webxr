import { describe, expect, it } from "vitest";

import {
  canFold,
  foldAxis,
  foldedAt,
  foldsAfterTurn,
  moveOf,
  prunedTo,
  RAIL_PX,
  railPx,
  railSide,
  UNFOLD_MIN_PX,
  unfoldedAt,
  type Folds,
} from "./dock-rail.js";

const LAYOUT = { width: 1440, height: 833 };

describe("the rail's size by input", () => {
  // Why: a rail is a row of buttons; a finger needs 44 px, a mouse is
  // served by 34 and leaves the 3D view more.
  it("is 34 px for a mouse and 44 px for a touch screen", () => {
    expect(railPx(false)).toBe(34);
    expect(railPx(true)).toBe(44);
    expect(RAIL_PX).toEqual({ mouse: 34, touch: 44 });
  });
});

describe("which way a group folds", () => {
  // Why: a side column folds to a narrow strip, a group below the view to
  // a short one; the group's own shape says which it is wherever it was
  // dragged.
  it("folds a tall group's width and a low group's height", () => {
    expect(foldAxis({ width: 248, height: 833 }, LAYOUT)).toBe("width");
    expect(foldAxis({ width: 300, height: 400 }, LAYOUT)).toBe("height");
    expect(foldAxis({ width: 900, height: 220 }, LAYOUT)).toBe("height");
  });

  it("takes 55 % of the layout's height as tall", () => {
    expect(foldAxis({ width: 300, height: 459 }, LAYOUT)).toBe("width");
    expect(foldAxis({ width: 300, height: 457 }, LAYOUT)).toBe("height");
  });

  // Why: a phone held upright docks its group across the window's whole
  // width, under the 3D view; dragged taller than 55 %, folding its width
  // squeezed the 3D view to a sliver beside a tall rail. A group as wide as
  // the layout has no side to fold to, so it folds its height, however tall.
  it("folds the height of a group as wide as the layout, however tall", () => {
    const phone = { width: 390, height: 777 };
    expect(foldAxis({ width: 390, height: 457 }, phone)).toBe("height");
    expect(foldAxis({ width: 390, height: 700 }, phone)).toBe("height");
    expect(foldAxis({ width: 389, height: 457 }, phone)).toBe("width");
    expect(foldAxis({ width: 1440, height: 600 }, LAYOUT)).toBe("height");
  });

  // Why: sizes come from the page's boxes; a box not laid out yet must not
  // decide the fold as NaN would (every comparison false).
  it("folds the width when a size is not a number", () => {
    expect(foldAxis({ width: 300, height: Number.NaN }, LAYOUT)).toBe("width");
    expect(foldAxis({ width: 300, height: 400 }, { width: 0, height: 0 })).toBe(
      "width",
    );
  });
});

describe("which groups fold", () => {
  // Why: the 3D view is the centre and never a rail; a floating group has
  // no splitter to hold a rail by.
  it("folds a docked group without the 3D view", () => {
    expect(canFold(["list"], "grid")).toBe(true);
    expect(canFold(["details", "files"], "grid")).toBe(true);
    expect(canFold(["view"], "grid")).toBe(false);
    expect(canFold(["view", "list"], "grid")).toBe(false);
    expect(canFold(["files"], "floating")).toBe(false);
    expect(canFold([], "grid")).toBe(false);
  });
});

describe("the fold's states", () => {
  // Why: unfolding gives the group back the size it had, so a creator's
  // splitter work survives a fold; a group folded small comes back at a
  // usable least size.
  it("remembers the size along the axis it folded and gives it back", () => {
    const folds = foldedAt(
      new Map(),
      "g1",
      { width: 260, height: 833 },
      LAYOUT,
    );
    expect(folds.get("g1")).toEqual({ axis: "width", prevPx: 260 });
    const { folds: after, restore } = unfoldedAt(folds, "g1");
    expect(after.has("g1")).toBe(false);
    expect(restore).toEqual({ axis: "width", px: 260 });
  });

  it("unfolds to at least 200 px wide or 120 px high", () => {
    expect(UNFOLD_MIN_PX).toEqual({ width: 200, height: 120 });
    const narrow = foldedAt(
      new Map(),
      "a",
      { width: 150, height: 833 },
      LAYOUT,
    );
    expect(unfoldedAt(narrow, "a").restore).toEqual({ axis: "width", px: 200 });
    const low = foldedAt(new Map(), "b", { width: 900, height: 90 }, LAYOUT);
    expect(unfoldedAt(low, "b").restore).toEqual({ axis: "height", px: 120 });
  });

  // Why: a second fold of a rail would record the rail's own 34 px as the
  // size to give back, and the group would come back as a rail.
  it("keeps the first size when a folded group is folded again", () => {
    const once = foldedAt(new Map(), "g", { width: 260, height: 833 }, LAYOUT);
    const twice = foldedAt(once, "g", { width: 34, height: 833 }, LAYOUT);
    expect(twice).toBe(once);
  });

  it("unfolds nothing for a group that is not folded", () => {
    const folds: Folds = new Map();
    const result = unfoldedAt(folds, "g");
    expect(result.folds).toBe(folds);
    expect(result.restore).toBeNull();
  });

  // Why: a group dragged empty is removed by the docking; its fold must
  // not outlive it (an id may be reused for a new group).
  it("forgets the folds of groups that are gone", () => {
    let folds = foldedAt(new Map(), "a", { width: 260, height: 833 }, LAYOUT);
    folds = foldedAt(folds, "b", { width: 900, height: 200 }, LAYOUT);
    const kept = prunedTo(folds, ["b", "c"]);
    expect([...kept.keys()]).toEqual(["b"]);
    expect(prunedTo(kept, ["b"])).toBe(kept);
  });

  it("does not fold a group whose size is not known", () => {
    const folds: Folds = new Map();
    expect(
      foldedAt(folds, "g", { width: Number.NaN, height: 833 }, LAYOUT),
    ).toBe(folds);
  });
});

describe("the side a group folds towards", () => {
  const view = { x: 248, y: 43, width: 892, height: 833 };
  // Why: the fold chevron points the way the group goes.
  it("is where the group lies against the 3D view", () => {
    expect(railSide({ x: 0, y: 43, width: 248, height: 833 }, view)).toBe(
      "left",
    );
    expect(railSide({ x: 1140, y: 43, width: 300, height: 833 }, view)).toBe(
      "right",
    );
    expect(railSide({ x: 248, y: 700, width: 892, height: 176 }, view)).toBe(
      "down",
    );
    expect(
      railSide(
        { x: 248, y: 43, width: 892, height: 100 },
        { ...view, y: 145, height: 731 },
      ),
    ).toBe("up");
  });
});

describe("a group's float and dock button", () => {
  // Why: the docking floats a group only by Shift-drag or its tab menu,
  // neither of which a finger finds; on a phone a docked group gets a
  // Float button and a floating one a Dock button (the prototype's). A
  // desk keeps its strips as they were.
  it("floats a docked group and docks a floating one, on a phone", () => {
    expect(moveOf("upright", "grid", false)).toBe("float");
    expect(moveOf("sideways", "grid", false)).toBe("float");
    expect(moveOf("upright", "floating", false)).toBe("dock");
  });

  it("is not there at a desk, on the 3D view's or a folded group", () => {
    expect(moveOf(null, "grid", false)).toBeNull();
    expect(moveOf(null, "floating", false)).toBeNull();
    expect(moveOf("upright", "grid", true)).toBeNull();
    expect(moveOf("sideways", "floating", true)).toBeNull();
    expect(moveOf("upright", "edge", false)).toBeNull();
    expect(moveOf("upright", "popout", false)).toBeNull();
  });
});

describe("the folds after a turn", () => {
  // Why: a turned phone (or a window crossing to another form factor)
  // brings back that form factor's kept arrangement, but the list's and
  // the details' folds are the session's: a fold made in one orientation
  // is the fold after the turn, and a fold kept from long ago (say, the
  // approach's) must not come back over a station just picked.
  it("a fold made in one orientation is the fold after a turn", () => {
    const groups: Record<string, string> = { list: "g1", details: "g2" };
    const at = (id: string) => groups[id] ?? null;
    expect(foldsAfterTurn(new Map([["list", true]]), at)).toEqual(
      new Map([["g1", true]]),
    );
    expect(
      foldsAfterTurn(
        new Map([
          ["list", false],
          ["details", true],
        ]),
        at,
      ),
    ).toEqual(
      new Map([
        ["g1", false],
        ["g2", true],
      ]),
    );
  });

  // Why: a phone's one group holds the list and the details; folded on
  // one side only at a desk, the turned group shows what was in sight
  // rather than hiding it.
  it("folds a shared group only when every panel in it was folded", () => {
    const one = () => "g";
    const both = (list: boolean, details: boolean) =>
      foldsAfterTurn(
        new Map([
          ["list", list],
          ["details", details],
        ]),
        one,
      ).get("g");
    expect(both(true, false)).toBe(false);
    expect(both(false, true)).toBe(false);
    expect(both(true, true)).toBe(true);
    expect(both(false, false)).toBe(false);
  });

  // Why: a panel the turned layout lacks has no group to fold.
  it("leaves out a panel with no group", () => {
    expect(foldsAfterTurn(new Map([["list", true]]), () => null)).toEqual(
      new Map(),
    );
  });
});
