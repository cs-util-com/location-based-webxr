// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { dockPanel, type DockPanelId } from "./dock-layout.js";
import { moveTargets, showMoveMenu, type MoveTarget } from "./dock-move.js";

const title = (id: DockPanelId) => dockPanel(id).title;

/** The default layout's groups, by made-up group ids. */
const GROUPS = [
  { id: "g-list", panels: ["list"] },
  { id: "g-view", panels: ["view"] },
  { id: "g-right", panels: ["details", "files"] },
  { id: "g-bottom", panels: ["problems", "history", "tiles", "perf"] },
] as const satisfies readonly { id: string; panels: DockPanelId[] }[];

describe("moveTargets", () => {
  // Why: the keyboard's move offers what a drag can do - another group as
  // a tab, or a group of its own at the 3D view's sides - and never the
  // 3D view's own group, which takes no tab.
  it("offers every other group, then the 3D view's sides", () => {
    expect(
      moveTargets("files", GROUPS, "g-view", title).map((t) => [
        t.label,
        t.group,
        t.position,
      ]),
    ).toEqual([
      ["Into List", "g-list", "center"],
      [
        "Into Problems, History, Map loading, Performance",
        "g-bottom",
        "center",
      ],
      ["Left of the 3D view", "g-view", "left"],
      ["Right of the 3D view", "g-view", "right"],
      ["Below the 3D view", "g-view", "bottom"],
    ]);
  });

  it("offers nothing for the 3D view, which never moves", () => {
    expect(moveTargets("view", GROUPS, "g-view", title)).toEqual([]);
  });

  it("offers nothing when the 3D view's group is not among the groups", () => {
    expect(moveTargets("files", GROUPS, "g-gone", title)).toEqual([]);
  });

  it("skips an empty group", () => {
    const targets = moveTargets(
      "list",
      [...GROUPS, { id: "g-empty", panels: [] }],
      "g-view",
      title,
    );
    expect(targets.some((t) => t.group === "g-empty")).toBe(false);
  });
});

describe("showMoveMenu", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const TARGETS: readonly MoveTarget[] = [
    { label: "Into List", group: "g-list", position: "center" },
    { label: "Below the 3D view", group: "g-view", position: "bottom" },
  ];

  function open() {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    anchor.focus();
    const onPick = vi.fn();
    const close = showMoveMenu({
      anchor,
      title: "Files",
      targets: TARGETS,
      onPick,
    });
    const menu = document.querySelector<HTMLElement>(".dock-move");
    if (menu === null) throw new Error("no menu");
    const items = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const key = (k: string) => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true }),
      );
    };
    return { anchor, onPick, close, menu, items, key };
  }

  // Why: the menu is the keyboard's whole path to moving a panel - it
  // must be named, take the focus, walk with the arrows and pick on
  // Enter (a menu item is a button).
  it("opens named and focused, walks with the arrows, picks on Enter", () => {
    const m = open();
    expect(m.menu.getAttribute("aria-label")).toBe("Move Files to");
    expect(document.activeElement).toBe(m.items[0]);
    m.key("ArrowDown");
    expect(document.activeElement).toBe(m.items[1]);
    m.key("ArrowDown");
    expect(document.activeElement).toBe(m.items[0]);
    m.key("ArrowUp");
    expect(document.activeElement).toBe(m.items[1]);
    m.key("Home");
    expect(document.activeElement).toBe(m.items[0]);
    m.key("End");
    m.items[1]?.click();
    expect(m.onPick).toHaveBeenCalledWith(TARGETS[1]);
    expect(document.querySelector(".dock-move")).toBeNull();
  });

  // Why: leaving the menu without a move must give the focus back to the
  // tab it was opened from, or a keyboard user is left on the page.
  it("closes on Escape with the focus back on its tab, picking nothing", () => {
    const m = open();
    m.key("Escape");
    expect(document.querySelector(".dock-move")).toBeNull();
    expect(document.activeElement).toBe(m.anchor);
    expect(m.onPick).not.toHaveBeenCalled();
  });

  it("closes on a press elsewhere", () => {
    const m = open();
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(document.querySelector(".dock-move")).toBeNull();
    expect(m.onPick).not.toHaveBeenCalled();
  });

  it("keeps one menu at a time", () => {
    open();
    open();
    expect(document.querySelectorAll(".dock-move")).toHaveLength(1);
  });

  it("closes from its returned close", () => {
    const m = open();
    m.close();
    expect(document.querySelector(".dock-move")).toBeNull();
  });
});
