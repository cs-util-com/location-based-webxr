import { describe, expect, it } from "vitest";

import {
  canFold,
  foldAxis,
  foldedAt,
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
