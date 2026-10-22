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
  DOCKS_SIDE_BY_SIDE_PX,
  TREE_STARTS_FOLDED_PX,
  docksAfter,
  type DockChange,
} from "./dock-rule.js";

const OPEN = { tree: false, inspector: false };

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
  const CHANGES = fc.constantFrom<DockChange>(
    "opened",
    "selected",
    "resized",
    "tree-unfolded",
    "inspector-unfolded",
  );

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
