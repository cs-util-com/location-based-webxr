/**
 * Why these tests matter: a station row's "+" adds in place through this
 * menu, from the mouse and from the keyboard alone. The focus must come
 * back to the station's "+" before the add runs (the add's redraw keeps
 * it there by the station's id: `editor-shell.test.ts`), or a keyboard
 * user is dropped to the page's top after every add. The menu's Escape
 * must stop there (the page's Escape drops the selection), and an item
 * that is off must add nothing.
 *
 * @vitest-environment jsdom
 */
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADD_CHOICES,
  addMenuSpot,
  createTreeAddMenu,
  type AddKind,
} from "./tree-add-menu.js";

/** A tree body with one station's "+". */
function plusFor(body: HTMLElement, id: string): HTMLButtonElement {
  const plus = document.createElement("button");
  plus.type = "button";
  plus.dataset["add"] = id;
  body.append(plus);
  return plus;
}

let body: HTMLElement;
let choose: ReturnType<typeof vi.fn<(id: string, kind: AddKind) => void>>;

beforeEach(() => {
  body = document.createElement("div");
  document.body.replaceChildren(body);
  choose = vi.fn<(id: string, kind: AddKind) => void>();
});

afterEach(() => {
  document.body.replaceChildren();
});

function opened() {
  const menu = createTreeAddMenu({ body, host: document.body, choose });
  const plus = plusFor(body, "gate");
  plus.focus();
  menu.openFor(plus, "gate", "The old gate");
  const root = document.getElementById("tree-add-menu");
  if (root === null) throw new Error("no menu");
  const item = (kind: string) =>
    root.querySelector<HTMLElement>(`[data-kind="${kind}"]`);
  return { menu, plus, root, item };
}

function key(target: Element, k: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: k,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("createTreeAddMenu", () => {
  it("opens as a menu titled by its station, the focus on its first item, the picture off with its reason", () => {
    const { root, item } = opened();
    expect(root.hidden).toBe(false);
    expect(root.getAttribute("role")).toBe("menu");
    expect(root.getAttribute("aria-label")).toBe("Add to The old gate");
    expect(root.querySelector(".mhead")?.textContent).toBe(
      "Add to The old gate",
    );
    expect(document.activeElement).toBe(item("pin"));
    expect(
      document
        .querySelector('[data-add="gate"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
        (i) => i.dataset["kind"],
      ),
    ).toEqual(ADD_CHOICES.map((c) => c.kind));
    const picture = item("picture");
    expect(picture?.getAttribute("aria-disabled")).toBe("true");
    expect(picture?.textContent).toContain("Taken on site with the phone");
    expect(item("longText")?.getAttribute("aria-disabled")).toBeNull();
  });

  it("moves with the arrows, Home, End and a letter, through the item that is off too", () => {
    const { root, item } = opened();
    key(root, "ArrowDown");
    expect(document.activeElement).toBe(item("longText"));
    key(root, "ArrowDown");
    expect(document.activeElement).toBe(item("picture"));
    key(root, "ArrowDown");
    expect(document.activeElement).toBe(item("pin"));
    key(root, "ArrowUp");
    expect(document.activeElement).toBe(item("picture"));
    key(root, "Home");
    expect(document.activeElement).toBe(item("pin"));
    key(root, "End");
    expect(document.activeElement).toBe(item("picture"));
    key(root, "l");
    expect(document.activeElement).toBe(item("longText"));
    key(root, "s");
    expect(document.activeElement).toBe(item("pin"));
  });

  it("adds the kind chosen to its station, closed first, the focus back on the station's +", () => {
    const { root, item, plus } = opened();
    item("longText")?.click();
    expect(root.hidden).toBe(true);
    expect(choose).toHaveBeenCalledWith("gate", "longText");
    expect(document.activeElement).toBe(plus);
    expect(plus.getAttribute("aria-expanded")).toBe("false");
  });

  // Why: on a phone the details cover a folded tree, so the station's +
  // cannot take the focus; a keyboard would land on nothing.
  it("goes back to the button pressed while the station's + is out of sight", () => {
    const { menu, plus } = opened();
    plus.closest("div")?.classList.add("collapsed");
    const details = document.createElement("button");
    document.body.append(details);
    menu.close(false);
    menu.openFor(details, "gate", "Gate");
    menu.close(true);
    expect(document.activeElement).toBe(details);
  });

  it("adds nothing for the item that is off, and stays open", () => {
    const { root, item } = opened();
    item("picture")?.click();
    expect(choose).not.toHaveBeenCalled();
    expect(root.hidden).toBe(false);
  });

  it("closes on Escape with the focus back on the +, the page's Escape not reached", () => {
    const { root, plus } = opened();
    const page = vi.fn();
    document.addEventListener("keydown", page);
    const event = key(document.activeElement as Element, "Escape");
    document.removeEventListener("keydown", page);
    expect(root.hidden).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(page).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(plus);
  });

  it("closes on Tab and on a press outside, the focus left where it goes", () => {
    const { menu, root, plus } = opened();
    key(root, "Tab");
    expect(root.hidden).toBe(true);
    menu.openFor(plus, "gate", "The old gate");
    expect(menu.isOpen()).toBe(true);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });
});

describe("addMenuSpot", () => {
  const view = { width: 1000, height: 800 };
  const size = { width: 250, height: 120 };

  it("opens under the button, rightwards from 20 px left of its right edge", () => {
    expect(
      addMenuSpot({ top: 100, right: 400, bottom: 128 }, size, view),
    ).toEqual({ left: 380, top: 130 });
  });

  it("keeps 8 px inside the window's edges and opens above where there is no room below", () => {
    expect(
      addMenuSpot({ top: 700, right: 20, bottom: 728 }, size, view),
    ).toEqual({ left: 8, top: 578 });
    expect(
      addMenuSpot({ top: 10, right: 2000, bottom: 30 }, size, view).left,
    ).toBe(742);
  });

  it("is inside the window wherever the button is, when the menu fits in it (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 770 }),
        (right, top) => {
          const spot = addMenuSpot(
            { top, right, bottom: top + 28 },
            size,
            view,
          );
          expect(spot.left).toBeGreaterThanOrEqual(8);
          expect(spot.left + size.width).toBeLessThanOrEqual(view.width - 8);
          expect(spot.top).toBeGreaterThanOrEqual(8);
          expect(spot.top + size.height).toBeLessThanOrEqual(view.height - 8);
        },
      ),
    );
  });
});
