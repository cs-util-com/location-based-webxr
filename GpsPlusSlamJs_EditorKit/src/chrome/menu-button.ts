/**
 * A menu button (the WAI-ARIA menu button pattern): a button that opens a
 * menu of commands, for the editor's File and View menus.
 *
 * - The button says it opens a menu (`aria-haspopup`), which one
 *   (`aria-controls`) and whether it is open (`aria-expanded`).
 * - A click, Enter or Space opens the menu on its first usable item;
 *   ArrowDown opens it there too, ArrowUp on its last.
 * - In the menu the arrow keys move through the items shown (not hidden
 *   - by its attribute or by the page's styles, as a view's own commands
 *   are on the other view - and not `disabled`, which cannot take the
 *   focus), wrapping; Home and End jump to the ends. An item disabled the
 *   pattern's way (`aria-disabled`, `setItemDisabled`) stays among them,
 *   so a screen reader says it is there; its click does nothing.
 * - Escape closes the menu and gives the focus back to its button (and
 *   goes no further: the page's own Escape does not run as well), from an
 *   item or from the button; Tab closes it and lets the focus move on. A
 *   page whose own Escape runs first asks `closeOpenMenu` before it.
 * - A click on an item runs the item's own handler, then closes the menu;
 *   the focus goes back to the button unless the item moved it elsewhere
 *   (a dialog it opened).
 * - A press outside the menu and its button closes it. One menu is open
 *   at a time.
 * - A menu that would open past the window's right edge moves left to end
 *   8 px inside it (never past the left edge), on opening and on every
 *   resize while open: on a phone a menu under a button in the bar's right
 *   half would hide its commands.
 * - A separator never starts or ends the items shown, and never follows
 *   another with nothing shown between them: such a one is hidden on
 *   opening.
 *
 * The items are the menu's `[role^="menuitem"]` elements; their roles,
 * words and checked states are the page's. Touch works through the same
 * clicks.
 *
 * @see menu-button.ts.md
 */

export interface MenuButton {
  isOpen(): boolean;
  /** Open the menu, with the focus on its first or last usable item. */
  open(at?: "first" | "last"): void;
  /** Close the menu; `returnFocus`: the focus goes back to its button. */
  close(returnFocus: boolean): void;
}

/** A menu's least distance from the window's edges when it moves (px). */
const EDGE_PX = 8;

/** The menu open now, if any: opening another closes it. */
let openMenu: MenuButton | null = null;

const ITEM =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

const SEPARATOR = '[role="separator"]';

/** Marks a separator this module hid, so it may show it again. */
const TIDIED = "data-menu-tidied";

/** Disable an item, or enable it, the pattern's way: `aria-disabled`,
 *  so it keeps its place in the arrow order (never `disabled`, which
 *  takes it out). */
export function setItemDisabled(item: HTMLElement, disabled: boolean): void {
  if (disabled) item.setAttribute("aria-disabled", "true");
  else item.removeAttribute("aria-disabled");
}

/** Whether `setItemDisabled` disabled the item. */
export function isItemDisabled(item: HTMLElement): boolean {
  return item.getAttribute("aria-disabled") === "true";
}

/** A menu item as code written for a button drives it: its `disabled`
 *  is `setItemDisabled`'s, the rest the item's own. */
export function menuItemControl(item: HTMLElement): {
  disabled: boolean;
  textContent: string | null;
  readonly dataset: DOMStringMap;
  addEventListener(type: "click", listener: () => void): void;
} {
  return {
    get disabled() {
      return isItemDisabled(item);
    },
    set disabled(on: boolean) {
      setItemDisabled(item, on);
    },
    get textContent() {
      return item.textContent;
    },
    set textContent(text: string | null) {
      item.textContent = text;
    },
    dataset: item.dataset,
    addEventListener(type, listener) {
      item.addEventListener(type, listener);
    },
  };
}

/** Close the menu open now, the focus back to its button: whether one was
 *  open. For a page whose own Escape runs before the menu hears the key. */
export function closeOpenMenu(): boolean {
  const open = openMenu;
  if (open === null || !open.isOpen()) return false;
  open.close(true);
  return true;
}

/** Whether the page shows `element` (its attribute or its styles). */
function shown(element: HTMLElement): boolean {
  return !element.hidden && getComputedStyle(element).display !== "none";
}

export function createMenuButton(deps: {
  readonly button: HTMLButtonElement;
  readonly menu: HTMLElement;
}): MenuButton {
  const { button, menu } = deps;
  if (menu.id === "") {
    throw new Error("a menu needs an id for its button's aria-controls");
  }
  if (button.id === "") {
    throw new Error("a menu button needs an id for its menu's label");
  }
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", menu.id);
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-labelledby", button.id);
  menu.hidden = true;
  for (const item of menu.querySelectorAll(ITEM)) {
    item.setAttribute("tabindex", "-1");
  }

  /** The items a key can move to, in order. */
  const usable = (): HTMLElement[] =>
    [...menu.querySelectorAll<HTMLElement>(ITEM)].filter(
      (item) => shown(item) && !(item as HTMLButtonElement).disabled,
    );

  /** Each separator shown only with an item shown on both sides of it,
   *  since the last separator shown. */
  const tidySeparators = (): void => {
    const parts = [
      ...menu.querySelectorAll<HTMLElement>(`${ITEM}, ${SEPARATOR}`),
    ];
    for (const part of parts) {
      if (part.hasAttribute(TIDIED)) {
        part.hidden = false;
        part.removeAttribute(TIDIED);
      }
    }
    let itemSince = false;
    parts.forEach((part, index) => {
      if (!part.matches(SEPARATOR)) {
        if (shown(part)) itemSince = true;
        return;
      }
      if (part.hidden) return;
      const next = parts.slice(index + 1);
      const end = next.findIndex((p) => p.matches(SEPARATOR));
      const itemAfter = (end < 0 ? next : next.slice(0, end)).some(shown);
      if (itemSince && itemAfter) {
        itemSince = false;
        return;
      }
      part.hidden = true;
      part.setAttribute(TIDIED, "");
    });
  };

  /** Inside the window: moved left by what runs past its right edge. */
  const place = (): void => {
    menu.style.left = "";
    const box = menu.getBoundingClientRect();
    const over = box.right - (window.innerWidth - EDGE_PX);
    const shift = Math.min(over, box.left - EDGE_PX);
    if (shift > 0) menu.style.left = `${String(-shift)}px`;
  };

  const focusAt = (index: number): void => {
    const items = usable();
    if (items.length === 0) {
      button.focus();
      return;
    }
    const at = ((index % items.length) + items.length) % items.length;
    items[at]?.focus();
  };

  const isOpen = (): boolean => !menu.hidden;

  const onResize = (): void => {
    place();
  };

  const onOutside = (event: Event): void => {
    const at = event.target;
    if (at instanceof Node && (menu.contains(at) || button.contains(at))) {
      return;
    }
    self.close(false);
  };

  const self: MenuButton = {
    isOpen,
    open(at = "first") {
      if (openMenu !== null && openMenu !== self) openMenu.close(false);
      openMenu = self;
      if (!isOpen()) {
        menu.hidden = false;
        tidySeparators();
        place();
        window.addEventListener("resize", onResize);
        button.setAttribute("aria-expanded", "true");
        button.classList.add("on");
        document.addEventListener("pointerdown", onOutside, true);
      }
      focusAt(at === "first" ? 0 : -1);
    },
    close(returnFocus) {
      if (openMenu === self) openMenu = null;
      if (!isOpen()) return;
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.classList.remove("on");
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("resize", onResize);
      if (returnFocus) button.focus();
    },
  };

  button.addEventListener("click", () => {
    if (isOpen()) self.close(true);
    else self.open("first");
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      self.open(event.key === "ArrowDown" ? "first" : "last");
    } else if (event.key === "Escape" && isOpen()) {
      // The focus stays here when the menu has no item to take it.
      event.preventDefault();
      event.stopPropagation();
      self.close(true);
    }
  });
  menu.addEventListener("keydown", (event) => {
    const items = usable();
    const index = items.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index < 0 ? -1 : index - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(-1);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        self.close(true);
        return;
      case "Tab":
        self.close(false);
        return;
      default:
        return;
    }
  });
  // Capturing: a disabled item's own handler never hears its click, and
  // the menu stays open.
  menu.addEventListener(
    "click",
    (event) => {
      const item = (event.target as Element | null)?.closest(ITEM);
      if (item instanceof HTMLElement && isItemDisabled(item)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  // Bubbling: the item's own handler has run by now.
  menu.addEventListener("click", (event) => {
    const item = (event.target as Element | null)?.closest(ITEM);
    if (item === null || item === undefined || !menu.contains(item)) return;
    const active = document.activeElement;
    const stayed =
      active === null || active === document.body || menu.contains(active);
    self.close(stayed);
  });
  return self;
}
