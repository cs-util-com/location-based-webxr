/**
 * The tree's type menu: what a station row's "+" (and its empty line's
 * "Add content") adds in place - a kind its row says is addable
 * (`KIND_EDIT` `add`; today a short text or a long text), at a free spot
 * of that station, or a story; a story row's "+" (and its empty line, and
 * its inspector's "Add entry...") adds such a kind into that story; a kind
 * listed but not addable (a picture: it is taken on site with the phone)
 * is shown off, with the reason. The head names the place. One menu for every row, opened
 * under the
 * button pressed, the WAI-ARIA menu's keys inside it: the arrows, Home and
 * End move among its items (an item that is off keeps its place, said by
 * `aria-disabled`), a letter jumps to the next item starting with it,
 * Escape closes it with the focus back on the station's "+" (and goes no
 * further: the page's Escape would drop the selection), Tab closes it and
 * lets the focus move on, a press outside closes it.
 *
 * The focus goes back by the row's id, not to the element pressed: the add
 * redraws the tree, and the row's "+" is the control that is there before
 * and after (its empty line is gone once it holds an item).
 * With the tree folded out of sight (the details on a phone) it goes to
 * the button pressed.
 *
 * @see tree-add-menu.ts.md
 */
import {
  setItemDisabled,
  shellIcon,
  type ShellIcon,
} from "gps-plus-slam-editor-kit/chrome";

import { ADD_CHOICES, type AddKind } from "../../kinds/edit-kinds.js";

export interface TreeAddMenu {
  /** Open under `anchor` for the station `stationId`, titled `title`, the
   *  focus on its first item. */
  openFor(anchor: HTMLElement, stationId: string, title: string): void;
  /** Open under `anchor` for the story `storyId`, named `title`, the focus
   *  on its first item; a story is not offered. */
  openForStory(anchor: HTMLElement, storyId: string, title: string): void;
  close(returnFocus: boolean): void;
  isOpen(): boolean;
}

/** What the menu adds: an addable kind, a character (made in the
 *  character maker first, then added) or a story. */
export type TreeAddChoice = AddKind | "character" | "story";

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
  /** The tree's body: where a row's "+" is found again. */
  readonly body: HTMLElement;
  /** Where the menu goes (the page's body). */
  readonly host: HTMLElement;
  /** Add `kind` to the station; run after the menu closed. */
  readonly choose: (stationId: string, kind: TreeAddChoice) => void;
  /** Add `kind` to the story; run after the menu closed. */
  readonly chooseForStory: (
    storyId: string,
    kind: Exclude<TreeAddChoice, "story">,
  ) => void;
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
  const itemOf = (
    kind: string,
    text: string,
    why: string,
    icon: ShellIcon,
  ): HTMLButtonElement => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    item.dataset["kind"] = kind;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = text;
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = why;
    item.append(shellIcon(icon), label, hint);
    return item;
  };
  for (const choice of ADD_CHOICES) {
    const item = itemOf(choice.kind, choice.label, choice.hint, choice.look);
    setItemDisabled(item, !choice.addable);
    menu.append(item);
  }
  // A character is made in the character maker first: not a kind row's
  // empty start, so it has an item of its own.
  menu.append(
    itemOf(
      "character",
      "Character",
      "Make one in the character maker, then add it here",
      "character",
    ),
  );
  // A story goes behind a line: it is a folder, the others are what fills
  // one.
  const storyPart = document.createElement("div");
  storyPart.className = "storypart";
  storyPart.append(
    itemOf("story", "Story", "A folder of entries that play in order", "story"),
  );
  menu.append(storyPart);
  deps.host.append(menu);
  let target: { kind: "station" | "story"; id: string } | null = null;
  /** The button it opened from, which says it is open (`aria-expanded`). */
  let opener: HTMLElement | null = null;

  const items = (): HTMLElement[] =>
    [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
      (item) => item.closest("[hidden]") === null || menu.hidden,
    );
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
    const from = target;
    const pressed = opener;
    menu.hidden = true;
    target = null;
    pressed?.setAttribute("aria-expanded", "false");
    opener = null;
    document.removeEventListener("pointerdown", onOutside, true);
    if (!returnFocus || from === null) return;
    const key = from.kind === "station" ? "add" : "storyadd";
    const plus = [
      ...deps.body.querySelectorAll<HTMLElement>(`[data-${key}]`),
    ].find((b) => b.dataset[key] === from.id);
    (plus?.closest(".collapsed, [hidden]") === null ? plus : pressed)?.focus();
  }

  function open(
    anchor: HTMLElement,
    to: { kind: "station" | "story"; id: string },
    words: string,
  ): void {
    if (isOpen()) close(false);
    target = to;
    opener = anchor;
    anchor.setAttribute("aria-expanded", "true");
    head.textContent = words;
    menu.setAttribute("aria-label", words);
    storyPart.hidden = to.kind === "story";
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
    if (item === null || target === null) return;
    if (item.getAttribute("aria-disabled") === "true") return;
    const from = target;
    const kind = item.dataset["kind"] as TreeAddChoice;
    close(true);
    if (from.kind === "station") deps.choose(from.id, kind);
    else if (kind !== "story") deps.chooseForStory(from.id, kind);
  });

  return {
    openFor(anchor, stationId, title) {
      open(anchor, { kind: "station", id: stationId }, `Add to ${title}`);
    },
    openForStory(anchor, storyId, title) {
      open(
        anchor,
        { kind: "story", id: storyId },
        `Add to the story "${title}"`,
      );
    },
    close,
    isOpen,
  };
}
