/**
 * Why these tests matter: the tree (272 px) and the inspector (290 px)
 * both lie over the 3D scene. On a desktop they sit side by side; on a
 * tablet in portrait (820 px) or a 768 px window they would leave a strip
 * of about 200-260 px of scene between them, so there one dock is open at
 * a time: opening the inspector folds the tree to its header, and
 * unfolding the tree folds the inspector. On a phone the tree starts
 * folded. Whatever happens, a narrow window never shows both docks open.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DOCK_LAYOUT,
  DOCKS_SIDE_BY_SIDE_PX,
  INSPECTOR_DOCK_PX,
  SCENE_FLOOR_PX,
  TREE_DOCK_PX,
  TREE_STARTS_FOLDED_PX,
  docksAfter,
  docksSideBySidePx,
  type DockChange,
  type DockLayout,
} from "./dock-rule.js";

const OPEN = { tree: false, inspector: false };

const CHANGES = fc.constantFrom<DockChange>(
  "opened",
  "selected",
  "resized",
  "tree-unfolded",
  "inspector-unfolded",
);

describe("the breakpoint", () => {
  // Why: the breakpoint is not a free number but the narrowest scene the
  // rule accepts between two open docks; the strips it rests on are
  // written down, and a change to a dock's width moves it with them.
  it("is the two docks plus the scene's floor between them", () => {
    expect(DOCKS_SIDE_BY_SIDE_PX).toBe(
      TREE_DOCK_PX + INSPECTOR_DOCK_PX + SCENE_FLOOR_PX,
    );
    const between = (widthPx: number) =>
      widthPx - TREE_DOCK_PX - INSPECTOR_DOCK_PX;
    expect([768, 820, 900, 1024].map(between)).toEqual([206, 258, 338, 462]);
    expect(between(DOCKS_SIDE_BY_SIDE_PX - 1)).toBeLessThan(SCENE_FLOOR_PX);
  });

  // The docks' widths against the stylesheet that draws them are the
  // app's to hold (the Tour Viewer's `editor-shell/dock-widths.test.ts`):
  // the kit draws no CSS.
});

describe("docksAfter", () => {
  it("keeps both docks open side by side on a wide window", () => {
    for (const change of ["opened", "selected", "resized"] as const) {
      expect(
        docksAfter(change, {
          widthPx: 1024,
          folded: OPEN,
          inspectorShows: true,
        }),
      ).toEqual(OPEN);
    }
  });

  it("folds the tree when the inspector opens on a tablet-wide window", () => {
    for (const widthPx of [768, 820]) {
      expect(
        docksAfter("selected", { widthPx, folded: OPEN, inspectorShows: true }),
      ).toEqual({ tree: true, inspector: false });
    }
  });

  it("folds the inspector when the tree is unfolded there, and the other way round", () => {
    expect(
      docksAfter("tree-unfolded", {
        widthPx: 820,
        folded: OPEN,
        inspectorShows: true,
      }),
    ).toEqual({ tree: false, inspector: true });
    expect(
      docksAfter("inspector-unfolded", {
        widthPx: 820,
        folded: OPEN,
        inspectorShows: true,
      }),
    ).toEqual({ tree: true, inspector: false });
  });

  it("starts with the tree folded on a phone, and open above", () => {
    expect(
      docksAfter("opened", {
        widthPx: TREE_STARTS_FOLDED_PX - 1,
        folded: OPEN,
        inspectorShows: false,
      }),
    ).toEqual({ tree: true, inspector: false });
    expect(
      docksAfter("opened", {
        widthPx: TREE_STARTS_FOLDED_PX,
        folded: OPEN,
        inspectorShows: false,
      }),
    ).toEqual(OPEN);
  });

  it("leaves the tree alone while no inspector shows", () => {
    expect(
      docksAfter("selected", {
        widthPx: 820,
        folded: OPEN,
        inspectorShows: false,
      }),
    ).toEqual(OPEN);
  });

  // Why: the rule's promise, for any width and any change: below the
  // breakpoint the creator never sees both docks open over the scene,
  // and above it the rule folds nothing.

  it("never leaves both docks open on a narrow window while the inspector shows", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 280, max: DOCKS_SIDE_BY_SIDE_PX - 1 }),
        CHANGES,
        fc.boolean(),
        fc.boolean(),
        (widthPx, change, tree, inspector) => {
          const after = docksAfter(change, {
            widthPx,
            folded: { tree, inspector },
            inspectorShows: true,
          });
          expect(after.tree || after.inspector).toBe(true);
        },
      ),
    );
  });

  it("folds nothing on a wide window", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: DOCKS_SIDE_BY_SIDE_PX, max: 2600 }),
        CHANGES,
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (widthPx, change, tree, inspector, inspectorShows) => {
          const folded = { tree, inspector };
          expect(
            docksAfter(change, { widthPx, folded, inspectorShows }),
          ).toEqual(folded);
        },
      ),
    );
  });
});

describe("a layout of the app's own", () => {
  // Why: the widths are the app's stylesheet's, not the kit's; another
  // editor with wider docks must get the same promise at its own
  // breakpoint, and the Tour Viewer's numbers stay the default.
  const WIDE: DockLayout = {
    treePx: 400,
    inspectorPx: 400,
    sceneFloorPx: 300,
    treeStartsFoldedPx: 500,
  };
  const state = (widthPx: number, inspectorShows = true) => ({
    widthPx,
    folded: OPEN,
    inspectorShows,
  });

  it("defaults to the Tour Viewer's widths", () => {
    expect(DEFAULT_DOCK_LAYOUT).toEqual({
      treePx: TREE_DOCK_PX,
      inspectorPx: INSPECTOR_DOCK_PX,
      sceneFloorPx: SCENE_FLOOR_PX,
      treeStartsFoldedPx: TREE_STARTS_FOLDED_PX,
    });
    expect(docksSideBySidePx(DEFAULT_DOCK_LAYOUT)).toBe(DOCKS_SIDE_BY_SIDE_PX);
  });

  it("moves the breakpoint and the phone start with the layout", () => {
    expect(docksSideBySidePx(WIDE)).toBe(1100);
    // 1000 px is wide for the default docks, narrow for these.
    expect(docksAfter("selected", state(1000))).toEqual(OPEN);
    expect(docksAfter("selected", state(1000), WIDE)).toEqual({
      tree: true,
      inspector: false,
    });
    expect(docksAfter("selected", state(1100), WIDE)).toEqual(OPEN);
    expect(docksAfter("opened", state(600, false), WIDE)).toEqual(OPEN);
    expect(docksAfter("opened", state(499, false), WIDE)).toEqual({
      tree: true,
      inspector: false,
    });
  });

  it("refuses a layout that is not a set of widths", () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(() =>
        docksAfter("resized", state(800), { ...WIDE, treePx: bad }),
      ).toThrow(RangeError);
    }
  });

  // Why a property: the one-dock promise holds for any layout, not only
  // the numbers the app ships with.
  it("never leaves both docks open below any layout's breakpoint", () => {
    const width = fc.integer({ min: 0, max: 800 });
    fc.assert(
      fc.property(
        fc.record({
          treePx: width,
          inspectorPx: width,
          sceneFloorPx: width,
          treeStartsFoldedPx: width,
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        CHANGES,
        fc.boolean(),
        fc.boolean(),
        (layout, at, change, tree, inspector) => {
          const breakpoint = docksSideBySidePx(layout);
          fc.pre(breakpoint > 0);
          const after = docksAfter(
            change,
            {
              widthPx: Math.floor(at * (breakpoint - 1)),
              folded: { tree, inspector },
              inspectorShows: true,
            },
            layout,
          );
          expect(after.tree || after.inspector).toBe(true);
        },
      ),
    );
  });
});
