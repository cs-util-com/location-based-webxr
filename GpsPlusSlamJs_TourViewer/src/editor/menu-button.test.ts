// @vitest-environment jsdom
/**
 * Why these tests matter: the editor's File and View menus hold Save,
 * Share and publish, Open and the view commands - a menu a keyboard or a
 * screen reader cannot drive hides them all. These pin the menu button
 * pattern: the button says it opens a menu and whether it is open; Enter,
 * Space or a click open it on its first item, the arrow keys move through
 * the items shown (wrapping, skipping hidden ones; a disabled item stays
 * reachable, so a screen reader can say it is there, and does nothing),
 * Home and End jump, Escape closes it and gives the focus back to its
 * button, Tab closes it and lets the focus go on, a click on an item runs
 * the item and closes the menu, a press outside closes it, one menu is
 * open at a time, an open menu stays inside a resized window, and a
 * separator never starts or ends the items shown.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeOpenMenu,
  createMenuButton,
  isItemDisabled,
  menuItemControl,
  setItemDisabled,
  type MenuButton,
} from "./menu-button.js";

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
      <button role="menuitem" type="button" id="save" aria-disabled="true">Save</button>
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
  // The module keeps the menu open now: one left open would be closed by
  // the next test.
  closeOpenMenu();
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
    // The focus was on an item that is gone: it comes back to the button.
    expect(focused()).toBe("file-btn");
    // Opened from code, without saying where: on the first item too.
    file.open();
    expect(focused()).toBe("open");
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

  it("the arrows move through the items shown, wrapping; Home and End jump", () => {
    const { fileButton } = setUp();
    fileButton.click();
    const menu = document.getElementById("file-menu") as HTMLElement;
    // Save is disabled, and reached all the same (the pattern's: it says
    // it is there); Hidden is hidden, and passed over.
    key(menu, "ArrowDown");
    expect(focused()).toBe("save");
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
    // The keys are the menu's: none scrolls the page as well.
    for (const name of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      expect(key(menu, name).defaultPrevented, name).toBe(true);
    }
    // ArrowUp from the first item wraps to the last.
    key(menu, "Home");
    key(menu, "ArrowUp");
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
    // Not pulled back to the button: the browser moves it on from here.
    expect(focused()).not.toBe("file-btn");
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

  // Why: an item that drops the focus (to the page's body) left the
  // keyboard nowhere; the button takes it back, as after an Escape.
  it("an item that drops the focus gives it back to the button", () => {
    const { file, fileButton, items } = setUp();
    const open = items.find((i) => i.id === "open");
    open?.addEventListener("click", () => {
      open.blur();
    });
    fileButton.click();
    open?.click();
    expect(file.isOpen()).toBe(false);
    expect(focused()).toBe("file-btn");
  });

  it("a click in the menu that is on no item (a separator) leaves it open", () => {
    const { file, fileButton } = setUp();
    fileButton.click();
    (
      document.querySelector('#file-menu [role="separator"]') as HTMLElement
    ).click();
    expect(file.isOpen()).toBe(true);
  });

  it("a press outside the menu and its button closes it, without taking the focus", () => {
    const { file, fileButton, outside } = setUp();
    fileButton.click();
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(file.isOpen()).toBe(false);
    expect(focused()).not.toBe("file-btn");
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
    // The first menu closes without taking the focus on its way out.
    const fileFocused = vi.fn();
    fileButton.addEventListener("focus", fileFocused);
    viewButton.click();
    expect(fileFocused).not.toHaveBeenCalled();
    expect(view.isOpen()).toBe(true);
    expect(file.isOpen()).toBe(false);
    expect(focused()).toBe("top");
  });

  // Why: a page's own Escape (the 3D view's help closing) runs before a
  // menu hears the key when the focus is not in the menu; it asks this
  // first, so an open menu - the newer popover - closes before the help.
  it("closeOpenMenu closes the menu open now, and says whether there was one", () => {
    const { file, fileButton } = setUp();
    expect(closeOpenMenu()).toBe(false);
    fileButton.click();
    (document.activeElement as HTMLElement).blur();
    expect(closeOpenMenu()).toBe(true);
    expect(file.isOpen()).toBe(false);
    expect(fileButton.getAttribute("aria-expanded")).toBe("false");
    // The focus goes back to the button, as for an Escape in the menu.
    expect(focused()).toBe("file-btn");
    expect(closeOpenMenu()).toBe(false);
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
      expect(focused()).toBe("save");
      key(document.getElementById("file-menu") as HTMLElement, "ArrowUp");
      expect(focused()).toBe("publish");
      key(document.getElementById("file-menu") as HTMLElement, "ArrowDown");
      expect(focused()).toBe("save");
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

  // Why: a disabled item is the pattern's "there, but not now" (Save with
  // nothing to save): it stays in the arrow order so a screen reader says
  // it, and it must then do nothing - no command run, the menu not closed.
  it("a disabled item does nothing when clicked or pressed, and the menu stays open", () => {
    const { file, fileButton } = setUp();
    const save = document.getElementById("save") as HTMLButtonElement;
    const ran = vi.fn();
    save.addEventListener("click", ran);
    fileButton.click();
    key(document.getElementById("file-menu") as HTMLElement, "ArrowDown");
    expect(focused()).toBe("save");
    // Enter and Space press a focused button by its click.
    const press = new MouseEvent("click", { bubbles: true, cancelable: true });
    save.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(ran).not.toHaveBeenCalled();
    expect(file.isOpen()).toBe(true);
    expect(focused()).toBe("save");
    setItemDisabled(save, false);
    save.click();
    expect(ran).toHaveBeenCalledTimes(1);
    expect(file.isOpen()).toBe(false);
  });

  it("disables an item by aria-disabled, never by the attribute that takes its focus", () => {
    const { items } = setUp();
    const open = items[0] as HTMLButtonElement;
    expect(isItemDisabled(open)).toBe(false);
    setItemDisabled(open, true);
    expect(open.getAttribute("aria-disabled")).toBe("true");
    expect(open.disabled).toBe(false);
    expect(isItemDisabled(open)).toBe(true);
    setItemDisabled(open, false);
    expect(open.hasAttribute("aria-disabled")).toBe(false);
    expect(isItemDisabled(open)).toBe(false);
  });

  // Why: code written for a button (the debug data add, the view switch)
  // disables what it drives through `disabled`; on a menu item that must
  // be the pattern's aria-disabled, or the item would leave the arrow order.
  it("menuItemControl gives code written for a button the item, disabled the pattern's way", () => {
    const { items } = setUp();
    const open = items[0] as HTMLButtonElement;
    const control = menuItemControl(open);
    const clicked = vi.fn();
    control.addEventListener("click", clicked);
    control.disabled = true;
    expect(open.getAttribute("aria-disabled")).toBe("true");
    expect(open.disabled).toBe(false);
    expect(control.disabled).toBe(true);
    control.textContent = "Opening…";
    expect(open.textContent).toBe("Opening…");
    expect(control.textContent).toBe("Opening…");
    control.dataset["state"] = "loading";
    expect(open.dataset["state"]).toBe("loading");
    control.disabled = false;
    expect(open.hasAttribute("aria-disabled")).toBe(false);
    open.click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("an item with the disabled attribute, which cannot take the focus, is passed over", () => {
    const { fileButton } = setUp();
    (document.getElementById("save") as HTMLButtonElement).disabled = true;
    fileButton.click();
    key(document.getElementById("file-menu") as HTMLElement, "ArrowDown");
    expect(focused()).toBe("keep");
  });

  // Why: with every item hidden or unusable the focus stays on the button,
  // so the menu's own Escape never hears the key, and the menu stayed open
  // with nothing in it to close it from the keyboard.
  it("Escape on the button closes an open menu that has no item to focus", () => {
    const { file, fileButton } = setUp();
    for (const item of document.querySelectorAll<HTMLButtonElement>(
      "#file-menu button",
    )) {
      item.hidden = true;
    }
    const page = vi.fn();
    document.addEventListener("keydown", page);
    fileButton.click();
    expect(focused()).toBe("file-btn");
    const event = key(fileButton, "Escape");
    expect(file.isOpen()).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(focused()).toBe("file-btn");
    // The page's own Escape (deselect) does not run as well.
    expect(page).not.toHaveBeenCalled();
    // A closed menu's button leaves Escape to the page.
    const passed = key(fileButton, "Escape");
    expect(page).toHaveBeenCalledTimes(1);
    expect(passed.defaultPrevented).toBe(false);
    document.removeEventListener("keydown", page);
    // Another key on the button of the open menu leaves it open.
    fileButton.click();
    key(fileButton, "x");
    expect(file.isOpen()).toBe(true);
  });

  // Why: a menu placed for a wide window stayed where it was when the
  // window narrowed (a phone turned, a desktop window dragged narrower),
  // its commands past the new edge.
  it("an open menu is placed again when the window is resized, and a closed one is left", () => {
    const { fileButton } = setUp();
    const menu = document.getElementById("file-menu") as HTMLElement;
    let width = 390;
    vi.spyOn(window, "innerWidth", "get").mockImplementation(() => width);
    vi.spyOn(menu, "getBoundingClientRect").mockImplementation(() => {
      const left =
        menu.style.left === "" ? 250 : 250 + parseFloat(menu.style.left);
      return { left, right: left + 230, width: 230 } as DOMRect;
    });
    fileButton.click();
    expect(menu.style.left).toBe("-98px");
    width = 300;
    window.dispatchEvent(new Event("resize"));
    // 480 - (300 - 8) = 188 px to the left.
    expect(menu.style.left).toBe("-188px");
    fileButton.click();
    width = 1000;
    window.dispatchEvent(new Event("resize"));
    expect(menu.style.left).toBe("-188px");
    vi.restoreAllMocks();
  });

  // Why: a menu's groups are parted by separators, and the items around
  // one come and go (the 3D view's commands over the map, the debug data
  // switch without a walk). A separator with nothing shown on one side
  // drew a stray line at the menu's top or bottom.
  it("hides a separator with no item shown before or after it, and two in a row", () => {
    document.body.innerHTML = `
      <style>.studio { display: none; }</style>
      <button id="btn" type="button">View</button>
      <div id="menu">
        <button role="menuitem" id="top" class="studio">Top view</button>
        <div role="separator" id="s1"></div>
        <button role="menuitem" id="a">A</button>
        <div role="separator" id="s2"></div>
        <button role="menuitem" id="debug" hidden>Debug</button>
        <div role="separator" id="s3"></div>
        <button role="menuitem" id="b" aria-disabled="true">B</button>
        <div role="separator" id="s4"></div>
        <button role="menuitem" id="frame" class="studio">Frame</button>
      </div>`;
    const button = document.getElementById("btn") as HTMLButtonElement;
    const menu = document.getElementById("menu") as HTMLElement;
    createMenuButton({ button, menu });
    const shown = () =>
      [...menu.querySelectorAll<HTMLElement>('[role="separator"]')]
        .filter((s) => !s.hidden)
        .map((s) => s.id);
    button.click();
    // s1 leads (only a hidden item before it), s4 trails, and s2 and s3
    // stand together with nothing shown between them: one stays.
    expect(shown()).toEqual(["s3"]);
    // Shown again once the items around them show; s2 and s3 still have
    // nothing shown between them.
    button.click();
    (document.querySelector("style") as HTMLStyleElement).remove();
    button.click();
    expect(shown()).toEqual(["s1", "s3", "s4"]);
  });

  // Why: the pattern's two links need both ids; without one the button
  // or the menu would be unnamed for a screen reader, silently.
  it("refuses a menu or a button without an id", () => {
    const make = (html: string) => {
      document.body.innerHTML = html;
      return () =>
        createMenuButton({
          button: document.querySelector("button") as HTMLButtonElement,
          menu: document.querySelector("div") as HTMLElement,
        });
    };
    expect(make('<button id="b">File</button><div></div>')).toThrow(
      "a menu needs an id for its button's aria-controls",
    );
    expect(make('<button>File</button><div id="m"></div>')).toThrow(
      "a menu button needs an id for its menu's label",
    );
  });

  // Why: the tidy marks only the separators it hid, and gives them back
  // on the next open; one the page hid itself is the page's and must stay
  // hidden, or a stray line came back.
  it("leaves a separator the page hid itself hidden, and tidies next to it", () => {
    document.body.innerHTML = `
      <button id="btn" type="button">View</button>
      <div id="menu">
        <button role="menuitem" id="a">A</button>
        <div role="separator" id="s1"></div>
        <div role="separator" id="s2"></div>
        <button role="menuitem" id="gone" hidden>Gone</button>
        <button role="menuitem" id="b">B</button>
        <div role="separator" id="s3"></div>
        <button role="menuitem" id="c">C</button>
      </div>`;
    const button = document.getElementById("btn") as HTMLButtonElement;
    const menu = document.getElementById("menu") as HTMLElement;
    createMenuButton({ button, menu });
    const shownSeparators = () =>
      [...menu.querySelectorAll<HTMLElement>('[role="separator"]')]
        .filter((s) => !s.hidden)
        .map((s) => s.id);
    const s3 = document.getElementById("s3") as HTMLElement;
    const c = document.getElementById("c") as HTMLElement;
    /** Close, let the page change, open again. */
    const reopen = (change: () => void) => {
      button.click();
      change();
      button.click();
    };
    button.click();
    // Two in a row: the first goes, the one before the items stays; a
    // separator with a hidden and a shown item after it stays.
    expect(shownSeparators()).toEqual(["s2", "s3"]);
    // C goes: s3 trails, so the tidy hides it; C back: s3 is back.
    reopen(() => (c.hidden = true));
    expect(shownSeparators()).toEqual(["s2"]);
    reopen(() => (c.hidden = false));
    expect(shownSeparators()).toEqual(["s2", "s3"]);
    // The page hides s3 itself (its group went): it stays hidden, through
    // C going and coming back.
    reopen(() => (s3.hidden = true));
    expect(shownSeparators()).toEqual(["s2"]);
    reopen(() => (c.hidden = true));
    reopen(() => (c.hidden = false));
    expect(shownSeparators()).toEqual(["s2"]);
  });
});
