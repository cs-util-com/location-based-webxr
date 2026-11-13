import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  foldAxis,
  foldedAt,
  prunedTo,
  UNFOLD_MIN_PX,
  unfoldedAt,
  type Folds,
} from "./dock-rail.js";

const size = fc.record({
  width: fc.integer({ min: 0, max: 4000 }),
  height: fc.integer({ min: 0, max: 3000 }),
});

describe("the fold's states over any sizes", () => {
  // Why: whatever size a group was folded at, unfolding gives back that
  // size (or the least usable one) along the axis it folded, and leaves no
  // trace; a second fold never overwrites the size to give back.
  it("fold then unfold gives back the size, at least the least size", () => {
    fc.assert(
      fc.property(size, size, (group, layout) => {
        const folds = foldedAt(new Map(), "g", group, layout);
        const fold = folds.get("g");
        expect(fold).toBeDefined();
        if (fold === undefined) return;
        expect(fold.axis).toBe(foldAxis(group, layout));
        const again = foldedAt(folds, "g", { width: 34, height: 34 }, layout);
        expect(again).toBe(folds);
        const { folds: after, restore } = unfoldedAt(folds, "g");
        expect(after.size).toBe(0);
        const was = fold.axis === "width" ? group.width : group.height;
        expect(restore?.px).toBe(Math.max(UNFOLD_MIN_PX[fold.axis], was));
      }),
    );
  });

  // Why: pruning to the live groups keeps exactly the folds of groups
  // still there, with their sizes untouched.
  it("prunes to exactly the live groups", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), {
          maxLength: 8,
        }),
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 8 }),
        (ids, live) => {
          let folds: Folds = new Map();
          for (const id of ids) {
            folds = foldedAt(
              folds,
              id,
              { width: 250, height: 800 },
              { width: 1400, height: 800 },
            );
          }
          const kept = prunedTo(folds, live);
          expect([...kept.keys()].sort()).toEqual(
            ids.filter((id) => live.includes(id)).sort(),
          );
          for (const [id, fold] of kept) expect(fold).toBe(folds.get(id));
        },
      ),
    );
  });
});
