/**
 * The tree's type menu: what a station row's "+" (and its empty line's
 * "Add content") adds in place - a short text or a long text, at a free
 * spot of that station; a picture is listed, off, with the reason (it is
 * taken on site with the phone). One menu for every row, opened under the
 * button pressed, the WAI-ARIA menu's keys inside it: the arrows, Home and
 * End move among its items (an item that is off keeps its place, said by
 * `aria-disabled`), a letter jumps to the next item starting with it,
 * Escape closes it with the focus back on the station's "+" (and goes no
 * further: the page's Escape would drop the selection), Tab closes it and
 * lets the focus move on, a press outside closes it.
 *
 * The focus goes back by the station's id, not to the element pressed:
 * the add redraws the tree, and the station's "+" is the control that is
 * there before and after (its empty line is gone once it holds an item).
 *
 * @see tree-add-menu.ts.md
 */
import {
  setItemDisabled,
  shellIcon,
  type ShellIcon,
} from "gps-plus-slam-editor-kit/chrome";

/** What a station's "+" adds: the kinds the editor can make from nothing. */
export type AddKind = "pin" | "longText";

/** One line of the menu (and of the Ctrl+K palette's kinds). */
export interface AddChoice {
  /** The kind it adds; `picture` adds nothing here. */
  readonly kind: AddKind | "picture";
  readonly label: string;
  /** What it is, or for one that is off, why. */
  readonly hint: string;
  /** The words a search for it matches (its label among them). */
  readonly words: string;
  /** The shell icon drawn beside it. */
  readonly icon: ShellIcon;
  readonly addable: boolean;
}

export const ADD_CHOICES: readonly AddChoice[] = [
  {
    kind: "pin",
    label: "Short text",
    hint: "A pin with a caption",
    words: "short text pin caption label note",
    icon: "pin",
    addable: true,
  },
  {
    kind: "longText",
    label: "Long text",
    hint: "A reading sign: a title and its text",
    words: "long text reading sign article body",
    icon: "text",
    addable: true,
  },
  {
    kind: "picture",
    label: "Picture",
    hint: "Taken on site with the phone",
    words: "picture photo image",
    icon: "photo",
    addable: false,
  },
];

export interface TreeAddMenu {
  /** Open under `anchor` for the station `stationId`, titled `title`, the
   *  focus on its first item. */
  openFor(anchor: HTMLElement, stationId: string, title: string): void;
  close(returnFocus: boolean): void;
  isOpen(): boolean;
}

/** The menu's least distance from the window's edges (px). */
const EDGE_PX = 8;

/** Its gap to the button it opened from (px). */
const GAP_PX = 2;

/** How far left of the button's right edge the menu starts (px): it
 *  opens rightwards, over the view beside the tree, not over its rows. */
const OVERLAP_PX = 20;

/**
 * Where the menu goes (its top left, window px) for a button at `anchor`
 * in a window `view` wide and high: under the button, starting
 * `OVERLAP_PX` left of its right edge, else as far right as fits, never
 * past the left edge less `EDGE_PX`; above the button where there is no
 * room below it.
 * Pure.
 */
export function addMenuSpot(
  anchor: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  },
  size: { readonly width: number; readonly height: number },
  view: { readonly width: number; readonly height: number },
): { left: number; top: number } {
  const left = Math.max(
    EDGE_PX,
    Math.min(anchor.right - OVERLAP_PX, view.width - size.width - EDGE_PX),
  );
  const below = anchor.bottom + GAP_PX;
  const top =
    below + size.height > view.height - EDGE_PX
      ? Math.max(EDGE_PX, anchor.top - size.height - GAP_PX)
      : below;
  return { left, top };
}

export function createTreeAddMenu(deps: {
  /** The tree's body: where the station's "+" is found again. */
  readonly body: HTMLElement;
  /** Where the menu goes (the page's body). */
  readonly host: HTMLElement;
  /** Add `kind` to the station; run after the menu closed. */
  readonly choose: (stationId: string, kind: AddKind) => void;
}): TreeAddMenu {
  const menu = document.createElement("div");
  menu.id = "tree-add-menu";
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const head = document.createElement("div");
  head.className = "mhead";
  head.setAttribute("aria-hidden", "true");
  menu.append(head);
  for (const choice of ADD_CHOICES) {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    item.dataset["kind"] = choice.kind;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = choice.label;
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = choice.hint;
    item.append(shellIcon(choice.icon), label, hint);
    setItemDisabled(item, !choice.addable);
    menu.append(item);
  }
  deps.host.append(menu);
  let station: string | null = null;
  /** The button it opened from, which says it is open (`aria-expanded`). */
  let opener: HTMLElement | null = null;

  const items = (): HTMLElement[] => [
    ...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ];
  const focusAt = (index: number): void => {
    const all = items();
    all[((index % all.length) + all.length) % all.length]?.focus();
  };
  const isOpen = (): boolean => !menu.hidden;

  const onOutside = (event: Event): void => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    close(false);
  };

  function close(returnFocus: boolean): void {
    if (!isOpen()) return;
    const id = station;
    menu.hidden = true;
    station = null;
    opener?.setAttribute("aria-expanded", "false");
    opener = null;
    document.removeEventListener("pointerdown", onOutside, true);
    if (!returnFocus || id === null) return;
    [...deps.body.querySelectorAll<HTMLElement>("[data-add]")]
      .find((b) => b.dataset["add"] === id)
      ?.focus();
  }

  menu.addEventListener("keydown", (event) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(at + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusAt(event.key === "Home" ? 0 : -1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    } else if (/^[a-z0-9]$/i.test(event.key)) {
      const letter = event.key.toLowerCase();
      const starts = (item: HTMLElement) =>
        (item.querySelector(".label")?.textContent ?? "")
          .toLowerCase()
          .startsWith(letter);
      const next =
        all.slice(at + 1).find(starts) ?? all.slice(0, at + 1).find(starts);
      next?.focus();
    }
  });
  menu.addEventListener("click", (event) => {
    const item = (event.target as Element).closest<HTMLElement>("[data-kind]");
    if (item === null || station === null) return;
    if (item.getAttribute("aria-disabled") === "true") return;
    const id = station;
    close(true);
    deps.choose(id, item.dataset["kind"] as AddKind);
  });

  return {
    openFor(anchor, stationId, title) {
      if (isOpen()) close(false);
      station = stationId;
      opener = anchor;
      anchor.setAttribute("aria-expanded", "true");
      head.textContent = `Add to ${title}`;
      menu.setAttribute("aria-label", `Add to ${title}`);
      menu.hidden = false;
      const { left, top } = addMenuSpot(
        anchor.getBoundingClientRect(),
        menu.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
      );
      menu.style.left = `${String(left)}px`;
      menu.style.top = `${String(top)}px`;
      document.addEventListener("pointerdown", onOutside, true);
      focusAt(0);
    },
    close,
    isOpen,
  };
}
