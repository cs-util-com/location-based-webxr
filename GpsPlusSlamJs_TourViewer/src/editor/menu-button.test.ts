// @vitest-environment jsdom
/**
 * Why these tests matter: the editor's File and View menus hold Save,
 * Share and publish, Open and the view commands - a menu a keyboard or a
 * screen reader cannot drive hides them all. These pin the menu button
 * pattern: the button says it opens a menu and whether it is open; Enter,
 * Space or a click open it on its first item, the arrow keys move through
 * the items that can be used (wrapping, skipping disabled and hidden
 * ones), Home and End jump, Escape closes it and gives the focus back to
 * its button, Tab closes it and lets the focus go on, a click on an item
 * runs the item and closes the menu, a press outside closes it, and one
 * menu is open at a time.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMenuButton, type MenuButton } from "./menu-button.js";

function setUp(): {
  file: MenuButton;
  view: MenuButton;
  fileButton: HTMLButtonElement;
  viewButton: HTMLButtonElement;
  items: HTMLButtonElement[];
  outside: HTMLButtonElement;
} {
  document.body.innerHTML = `
    <button id="file-btn" type="button">File</button>
    <div id="file-menu">
      <button role="menuitem" type="button" id="open">Open…</button>
      <button role="menuitem" type="button" id="save" disabled>Save</button>
      <div role="separator"></div>
      <button role="menuitem" type="button" id="hidden" hidden>Hidden</button>
      <button role="menuitemcheckbox" type="button" id="keep" aria-checked="false">Keep</button>
      <button role="menuitem" type="button" id="publish">Share and publish…</button>
    </div>
    <button id="view-btn" type="button">View</button>
    <div id="view-menu">
      <button role="menuitem" type="button" id="top">Top view</button>
    </div>
    <button id="outside" type="button">Elsewhere</button>`;
  const fileButton = document.getElementById("file-btn") as HTMLButtonElement;
  const viewButton = document.getElementById("view-btn") as HTMLButtonElement;
  const file = createMenuButton({
    button: fileButton,
    menu: document.getElementById("file-menu") as HTMLElement,
  });
  const view = createMenuButton({
    button: viewButton,
    menu: document.getElementById("view-menu") as HTMLElement,
  });
  const items = [
    ...document.querySelectorAll<HTMLButtonElement>("#file-menu button"),
  ];
  const outside = document.getElementById("outside") as HTMLButtonElement;
  return { file, view, fileButton, viewButton, items, outside };
}

function key(target: Element, name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

const focused = () => (document.activeElement as HTMLElement | null)?.id;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("createMenuButton", () => {
  it("marks the button and the menu by the menu button pattern, closed", () => {
    const { fileButton } = setUp();
    const menu = document.getElementById("file-menu") as HTMLElement;
    expect(fileButton.getAttribute("aria-haspopup")).toBe("menu");
    expect(fileButton.getAttribute("aria-expanded")).toBe("false");
    expect(fileButton.getAttribute("aria-controls")).toBe("file-menu");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-labelledby")).toBe("file-btn");
    expect(menu.hidden).toBe(true);
    // The items are reached by the arrow keys, never by Tab.
    for (const item of menu.querySelectorAll("[role^='menuitem']")) {
      expect(item.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("a click opens the menu on its first usable item, a second click closes it", () => {
    const { file, fileButton } = setUp();
    fileButton.click();
    expect(file.isOpen()).toBe(true);
    expect(fileButton.getAttribute("aria-expanded")).toBe("true");
    expect(focused()).toBe("open");
    fileButton.click();
    expect(file.isOpen()).toBe(false);
    expect(fileButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("ArrowDown opens on the first item, ArrowUp on the last", () => {
    const { file, fileButton } = setUp();
    fileButton.focus();
    expect(key(fileButton, "ArrowDown").defaultPrevented).toBe(true);
    expect(focused()).toBe("open");
    file.close(true);
    expect(focused()).toBe("file-btn");
    key(fileButton, "ArrowUp");
    expect(focused()).toBe("publish");
  });

  it("the arrows move through the usable items, wrapping; Home and End jump", () => {
    const { fileButton } = setUp();
    fileButton.click();
    const menu = document.getElementById("file-menu") as HTMLElement;
    // Save is disabled and Hidden is hidden: both are passed over.
    key(menu, "ArrowDown");
    expect(focused()).toBe("keep");
    key(menu, "ArrowDown");
    expect(focused()).toBe("publish");
    key(menu, "ArrowDown");
    expect(focused()).toBe("open");
    key(menu, "ArrowUp");
    expect(focused()).toBe("publish");
    key(menu, "Home");
    expect(focused()).toBe("open");
    key(menu, "End");
    expect(focused()).toBe("publish");
  });

  it("Escape closes the menu and gives the focus back to its button, and goes no further", () => {
    const { file, fileButton } = setUp();
    const page = vi.fn();
    document.addEventListener("keydown", page);
    fileButton.click();
    const menu = document.getElementById("file-menu") as HTMLElement;
    key(menu, "Escape");
    expect(file.isOpen()).toBe(false);
    expect(menu.hidden).toBe(true);
    expect(focused()).toBe("file-btn");
    // The page's own Escape (deselect) does not run as well.
    expect(page).not.toHaveBeenCalled();
    document.removeEventListener("keydown", page);
  });

  it("Tab closes the menu and lets the focus move on", () => {
    const { file, fileButton } = setUp();
    fileButton.click();
    const menu = document.getElementById("file-menu") as HTMLElement;
    const event = key(menu, "Tab");
    expect(file.isOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("a click on an item runs it, closes the menu and gives the focus back to the button", () => {
    const { file, items } = setUp();
    const ran = vi.fn();
    const publish = items.find((i) => i.id === "publish");
    publish?.addEventListener("click", ran);
    document.getElementById("file-btn")?.click();
    publish?.click();
    expect(ran).toHaveBeenCalledTimes(1);
    expect(file.isOpen()).toBe(false);
    expect(focused()).toBe("file-btn");
  });

  it("an item that moves the focus elsewhere (a dialog) keeps it there", () => {
    const { file, items, outside } = setUp();
    const open = items.find((i) => i.id === "open");
    open?.addEventListener("click", () => {
      outside.focus();
    });
    document.getElementById("file-btn")?.click();
    open?.click();
    expect(file.isOpen()).toBe(false);
    expect(focused()).toBe("outside");
  });

  it("a press outside the menu and its button closes it, without taking the focus", () => {
    const { file, fileButton, outside } = setUp();
    fileButton.click();
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(file.isOpen()).toBe(false);
    // A press inside the open menu keeps it open.
    fileButton.click();
    document
      .getElementById("keep")
      ?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(file.isOpen()).toBe(true);
  });

  it("one menu is open at a time", () => {
    const { file, view, fileButton, viewButton } = setUp();
    fileButton.click();
    viewButton.click();
    expect(view.isOpen()).toBe(true);
    expect(file.isOpen()).toBe(false);
    expect(focused()).toBe("top");
  });

  it("a menu with no usable item opens with the focus on its button", () => {
    const { fileButton } = setUp();
    for (const item of document.querySelectorAll<HTMLButtonElement>(
      "#file-menu button",
    )) {
      item.disabled = true;
    }
    fileButton.click();
    expect(fileButton.getAttribute("aria-expanded")).toBe("true");
    expect(focused()).toBe("file-btn");
    key(document.getElementById("file-menu") as HTMLElement, "ArrowDown");
    expect(focused()).toBe("file-btn");
  });

  it("skips an item the page's styles do not show (a view's own command on another view)", () => {
    // Why: the View menu's Top view and Frame are the 3D view's; over the
    // map a style hides them (no `hidden` attribute). A key landing on one
    // would leave the focus nowhere.
    const { fileButton } = setUp();
    const style = document.createElement("style");
    style.textContent = "#open { display: none; }";
    document.head.append(style);
    try {
      fileButton.click();
      expect(focused()).toBe("keep");
      key(document.getElementById("file-menu") as HTMLElement, "ArrowDown");
      expect(focused()).toBe("publish");
      key(document.getElementById("file-menu") as HTMLElement, "ArrowDown");
      expect(focused()).toBe("keep");
    } finally {
      style.remove();
    }
  });

  it("moves a menu that would open past the window's right edge back inside it", () => {
    // Why: at a phone's width the View menu, 230 px wide under a button at
    // the bar's right half, ran past the window and hid its commands.
    const { fileButton } = setUp();
    const menu = document.getElementById("file-menu") as HTMLElement;
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    const rect = (left: number): DOMRect =>
      ({ left, right: left + 230, width: 230 }) as DOMRect;
    // Where it opens by the page's styles: left 250, its right at 480.
    vi.spyOn(menu, "getBoundingClientRect").mockImplementation(() =>
      rect(menu.style.left === "" ? 250 : 250 + parseFloat(menu.style.left)),
    );
    fileButton.click();
    // 8 px in from the right edge: 480 - (390 - 8) = 98 px to the left.
    expect(menu.style.left).toBe("-98px");
    fileButton.click();
    // A menu that fits keeps the page's place.
    vi.spyOn(menu, "getBoundingClientRect").mockImplementation(() => rect(20));
    fileButton.click();
    expect(menu.style.left).toBe("");
    vi.restoreAllMocks();
  });

  it("never moves a menu past the window's left edge", () => {
    const { fileButton } = setUp();
    const menu = document.getElementById("file-menu") as HTMLElement;
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(240);
    vi.spyOn(menu, "getBoundingClientRect").mockImplementation(
      () => ({ left: 30, right: 260, width: 230 }) as DOMRect,
    );
    fileButton.click();
    // 28 px would bring its right edge in, but only 22 keeps its left 8 px
    // from the window's edge.
    expect(menu.style.left).toBe("-22px");
    vi.restoreAllMocks();
  });

  it("refuses a menu without an id: the button could not name it", () => {
    document.body.innerHTML = "<button>File</button><div></div>";
    expect(() =>
      createMenuButton({
        button: document.querySelector("button") as HTMLButtonElement,
        menu: document.querySelector("div") as HTMLElement,
      }),
    ).toThrow(/id/);
  });
});
