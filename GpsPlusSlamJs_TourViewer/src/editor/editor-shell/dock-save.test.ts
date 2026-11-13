import { describe, expect, it } from "vitest";
import type { SerializedDockview } from "dockview";

import { DOCK_PANELS } from "./dock-layout.js";
import {
  dockFormFactor,
  dockSaveKey,
  readSavedDock,
  writeSavedDock,
} from "./dock-save.js";

/** A layout as the docking library describes it: the list, the 3D view
 *  and the right column side by side, the bottom panes in one group. */
function layoutOf(
  groups: readonly (readonly string[])[],
  floating: readonly (readonly string[])[] = [],
): SerializedDockview {
  const leaf = (views: readonly string[], n: number) => ({
    type: "leaf",
    data: { id: String(n), views: [...views], activeView: views[0] },
    size: 100,
  });
  const ids = [...groups, ...floating].flat();
  return {
    grid: {
      root: {
        type: "branch",
        data: groups.map((g, n) => leaf(g, n)),
        size: 600,
      },
      width: 1200,
      height: 600,
      orientation: "HORIZONTAL",
    },
    panels: Object.fromEntries(
      ids.map((id) => [id, { id, contentComponent: id, title: id }]),
    ),
    floatingGroups: floating.map((g, n) => ({
      data: { id: `f${String(n)}`, views: [...g] },
      position: { left: 0, top: 0, width: 200, height: 200 },
    })),
  } as unknown as SerializedDockview;
}

const DEFAULT_GROUPS = [
  ["list"],
  ["view"],
  ["details", "files"],
  ["problems", "history", "tiles", "perf"],
];

describe("dockFormFactor", () => {
  // Why: each shape of window keeps its own layout; a phone held
  // sideways must not get the desk's three columns back, nor the desk
  // the phone's.
  it("tells a desk from a phone held sideways or upright", () => {
    expect(dockFormFactor(1440, 900)).toBe("desk");
    expect(dockFormFactor(701, 501)).toBe("desk");
    expect(dockFormFactor(844, 390)).toBe("sideways");
    expect(dockFormFactor(1024, 500)).toBe("sideways");
    expect(dockFormFactor(390, 844)).toBe("upright");
    expect(dockFormFactor(700, 900)).toBe("upright");
  });

  it("reads a window of no size as a desk", () => {
    expect(dockFormFactor(Number.NaN, Number.NaN)).toBe("desk");
  });

  it("keys each form factor apart", () => {
    const keys = (["desk", "sideways", "upright"] as const).map(dockSaveKey);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe("editor-dock-layout:desk");
  });
});

describe("readSavedDock", () => {
  // Why: what was kept comes back as it was, the folds with it.
  it("reads back a layout it wrote", () => {
    const layout = layoutOf([
      ["list"],
      ["view"],
      ["details", "problems"],
      ["files"],
      ["history", "tiles", "perf"],
    ]);
    const raw = writeSavedDock(layout, [{ panel: "list", prevPx: 248 }]);
    expect(readSavedDock(raw)).toEqual({
      layout,
      folds: [{ panel: "list", prevPx: 248 }],
    });
  });

  it("reads a panel floated out of the grid", () => {
    const layout = layoutOf(
      [["list"], ["view"], ["details", "files"], ["problems", "tiles", "perf"]],
      [["history"]],
    );
    expect(readSavedDock(writeSavedDock(layout, []))?.layout).toEqual(layout);
  });

  // Why: a broken kept layout must fall back to the default, never load
  // an empty or partial one - every way it can be broken is refused.
  it.each([
    ["nothing kept", null],
    ["not JSON", "{oops"],
    ["not an object", "[1,2]"],
    [
      "another version",
      JSON.stringify({ v: 2, layout: layoutOf(DEFAULT_GROUPS), folds: [] }),
    ],
    ["no layout", JSON.stringify({ v: 1, folds: [] })],
    [
      "a panel missing",
      writeSavedDock(
        layoutOf([["list"], ["view"], ["details", "files"], ["problems"]]),
        [],
      ),
    ],
    [
      "an unknown panel",
      writeSavedDock(layoutOf([...DEFAULT_GROUPS, ["chat"]]), []),
    ],
    [
      "a panel twice",
      writeSavedDock(layoutOf([...DEFAULT_GROUPS, ["files"]]), []),
    ],
    ["an empty group", writeSavedDock(layoutOf([...DEFAULT_GROUPS, []]), [])],
    [
      "a panel beside the 3D view in its group",
      writeSavedDock(
        layoutOf([
          ["list", "view"],
          ["details", "files"],
          ["problems", "history", "tiles", "perf"],
        ]),
        [],
      ),
    ],
    [
      "the 3D view floated",
      writeSavedDock(
        layoutOf(
          [
            ["list"],
            ["details", "files"],
            ["problems", "history", "tiles", "perf"],
          ],
          [["view"]],
        ),
        [],
      ),
    ],
    [
      "a popout window",
      JSON.stringify({
        v: 1,
        layout: {
          ...layoutOf(DEFAULT_GROUPS),
          popoutGroups: [{ data: { views: ["files"] } }],
        },
        folds: [],
      }),
    ],
    [
      "a grid node of another shape",
      JSON.stringify({
        v: 1,
        layout: {
          ...layoutOf(DEFAULT_GROUPS),
          grid: { root: { type: "tree", data: [] } },
        },
        folds: [],
      }),
    ],
  ])("refuses %s", (_what, raw) => {
    expect(readSavedDock(raw)).toBeNull();
  });

  it("leaves out a fold that names no foldable panel or size", () => {
    const raw = JSON.stringify({
      v: 1,
      layout: layoutOf(DEFAULT_GROUPS),
      folds: [
        { panel: "details", prevPx: 300 },
        { panel: "view", prevPx: 300 },
        { panel: "chat", prevPx: 300 },
        { panel: "list", prevPx: -1 },
        { panel: "list", prevPx: "248" },
        null,
      ],
    });
    expect(readSavedDock(raw)?.folds).toEqual([
      { panel: "details", prevPx: 300 },
    ]);
  });

  it("reads folds that are not a list as none", () => {
    const raw = JSON.stringify({
      v: 1,
      layout: layoutOf(DEFAULT_GROUPS),
      folds: "list",
    });
    expect(readSavedDock(raw)?.folds).toEqual([]);
  });

  it("knows every panel the layout docks", () => {
    expect(
      readSavedDock(writeSavedDock(layoutOf(DEFAULT_GROUPS), [])),
    ).not.toBeNull();
    expect(DEFAULT_GROUPS.flat().sort()).toEqual(
      DOCK_PANELS.map((p) => p.id).sort(),
    );
  });
});
