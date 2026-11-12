import { describe, expect, it } from "vitest";

import { PANEL_TABS } from "./bottom-panel-model.js";
import { PHONE_SHEET_PX } from "./phone-sheet.js";
import {
  BOTTOM_PANEL_IDS,
  bottomStartPx,
  defaultDockLayout,
  DOCK_PANELS,
  dockPanel,
  docksAt,
  dockWidths,
  isBottomPanelId,
  isDockPanelId,
} from "./dock-layout.js";

describe("where the panels dock", () => {
  // Why: a phone held sideways (844 px) docks, an upright one (390 px)
  // keeps its sheets, and no width is both or neither: the docking starts
  // exactly one pixel above the sheets' last width.
  it("docks from 701 px, right above the phone's sheets", () => {
    expect(docksAt(PHONE_SHEET_PX)).toBe(false);
    expect(docksAt(PHONE_SHEET_PX + 1)).toBe(true);
    expect(docksAt(700)).toBe(false);
    expect(docksAt(701)).toBe(true);
    expect(docksAt(844)).toBe(true);
    expect(docksAt(390)).toBe(false);
    expect(docksAt(Number.NaN)).toBe(false);
  });
});

describe("the docked panels", () => {
  // Why: the host adopts the page's own elements by these ids; a panel
  // without one, or two panels on one element, would leave a panel empty
  // or move an element twice.
  it("adopt one page element each, the 3D view none", () => {
    const elements = DOCK_PANELS.map((p) => p.element);
    expect(elements.filter((e) => e === null)).toHaveLength(1);
    expect(dockPanel("view").element).toBeNull();
    const named = elements.filter((e): e is string => e !== null);
    expect(new Set(named).size).toBe(named.length);
    expect(dockPanel("list").element).toBe("shell-tree");
    expect(dockPanel("details").element).toBe("shell-inspector");
    expect(dockPanel("files").element).toBe("shell-shelf");
    for (const id of BOTTOM_PANEL_IDS) {
      expect(dockPanel(id).element).toBe(`shell-pane-${id}`);
      expect(dockPanel(id).group).toBe("bottom");
    }
  });

  // Why: the bottom panel shows a docked tab by its own tab id; a tab
  // added there without a docked panel would open to nothing.
  it("dock the bottom panel's tabs, one each, in its order", () => {
    expect([...BOTTOM_PANEL_IDS]).toEqual(PANEL_TABS.map((t) => t.id));
    expect(isBottomPanelId("tiles")).toBe(true);
    expect(isBottomPanelId("details")).toBe(false);
  });

  // Why: ids come back from the docking library's events as plain strings.
  it("knows its ids and refuses others", () => {
    expect(isDockPanelId("files")).toBe(true);
    expect(isDockPanelId("shelf")).toBe(false);
    expect(isDockPanelId(null)).toBe(false);
    expect(() => dockPanel("nope" as never)).toThrow(/nope/);
  });
});

describe("the default layout", () => {
  // Why: the chosen arrangement - list left, the 3D view, one right group
  // with Details shown and Files as its second tab, the bottom panel's
  // tabs below the view with Problems first.
  it("is the chosen arrangement at a desktop", () => {
    expect(defaultDockLayout(1440, 900)).toEqual([
      { id: "view" },
      { id: "list", against: { id: "view", direction: "left" }, widthPx: 248 },
      {
        id: "details",
        against: { id: "view", direction: "right" },
        widthPx: 300,
      },
      {
        id: "files",
        against: { id: "details", direction: "within" },
        inactive: true,
      },
      {
        id: "problems",
        against: { id: "view", direction: "below" },
        heightPx: 220,
      },
      {
        id: "history",
        against: { id: "problems", direction: "within" },
        inactive: true,
      },
      {
        id: "tiles",
        against: { id: "problems", direction: "within" },
        inactive: true,
      },
      {
        id: "perf",
        against: { id: "problems", direction: "within" },
        inactive: true,
      },
    ]);
  });

  // Why: the side panels narrow in steps so a smaller window keeps a
  // usable 3D view (the same steps as the undocked shell's).
  it("narrows the side panels on smaller windows", () => {
    expect(dockWidths(1920)).toEqual({ list: 248, column: 300 });
    expect(dockWidths(1100)).toEqual({ list: 210, column: 300 });
    expect(dockWidths(900)).toEqual({ list: 210, column: 268 });
    expect(dockWidths(844)).toEqual({ list: 210, column: 268 });
  });

  // Why: on a phone held sideways the bottom panel must not take the 3D
  // view; on a desktop it starts at the undocked panel's 220 px.
  it("starts the bottom group at a third of the height, 90 to 220 px", () => {
    expect(bottomStartPx(900)).toBe(220);
    expect(bottomStartPx(326)).toBe(108);
    expect(bottomStartPx(100)).toBe(90);
    expect(bottomStartPx(-5)).toBe(90);
  });
});
