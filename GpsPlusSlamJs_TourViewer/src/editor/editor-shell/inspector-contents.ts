/**
 * A station's Contents in the inspector: its items, a row each by kind and
 * name; a press on one (`data-act="goto:<id>"`, answered by the shell)
 * selects it, as the tree's row does. On a phone the tree is out of sight
 * while the details show, so this is the way on from a station to what
 * it holds. Text only, never markup.
 *
 * @see inspector-contents.ts.md
 */
import { shellIcon } from "gps-plus-slam-editor-kit/chrome";

import type { StationContent } from "./tree-model.js";

/** The fold's one-line summary. */
export function contentsSummary(count: number): string {
  return `${String(count)} ${count === 1 ? "item" : "items"}`;
}

function textOf(tag: "span" | "div", className: string, text: string) {
  const made = document.createElement(tag);
  made.className = className;
  made.textContent = text;
  return made;
}

function rowOf(item: StationContent): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "kid";
  row.dataset["act"] = `goto:${item.id}`;
  row.title = item.title;
  const icon = document.createElement("span");
  icon.className = `ic ${item.kind}`;
  icon.append(shellIcon(item.kind));
  row.append(icon, textOf("span", "nm", item.title));
  return row;
}

/** The fold's body: the rows, or a line saying there are none, then `add`
 *  and how else to add. */
export function contentsBody(
  items: readonly StationContent[],
  add: HTMLElement,
): HTMLElement[] {
  const list = document.createElement("div");
  list.className = "kids";
  list.append(...items.map(rowOf));
  return [
    items.length === 0
      ? textOf("div", "note", "Nothing at this station yet.")
      : list,
    add,
    textOf(
      "div",
      "note",
      "The same menu as the + on the station's row in the list. Or press Ctrl+K.",
    ),
  ];
}
