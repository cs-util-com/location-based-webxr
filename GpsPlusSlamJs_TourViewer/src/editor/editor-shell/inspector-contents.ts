/**
 * A station's Contents in the inspector: its stories and its free items, a
 * row each by kind and name, and a story's Entries, numbered, in the same
 * look; a press on one (`data-act="goto:<id>"`, answered by the shell)
 * selects it, as the tree's row does. On a phone the tree is out of sight
 * while the details show, so this is the way on from a station to what
 * it holds. Text only, never markup.
 *
 * @see inspector-contents.ts.md
 */
import { shellIcon } from "gps-plus-slam-editor-kit/chrome";

import type { StationContent } from "./tree-model.js";

/** The fold's one-line summary: "2 items", or "1 story, 2 free items" once
 *  it holds a story. */
export function contentsSummary(
  contents: readonly Pick<StationContent, "kind">[],
): string {
  const stories = contents.filter((c) => c.kind === "story").length;
  const free = contents.length - stories;
  const items = (word: string) =>
    `${String(free)} ${word}${free === 1 ? "" : "s"}`;
  if (stories === 0) return items("item");
  const said = `${String(stories)} ${stories === 1 ? "story" : "stories"}`;
  return free === 0 ? said : `${said}, ${items("free item")}`;
}

function textOf(tag: "span" | "div", className: string, text: string) {
  const made = document.createElement(tag);
  made.className = className;
  made.textContent = text;
  return made;
}

function rowOf(
  item: Pick<StationContent, "id" | "kind" | "title"> & {
    readonly place?: number;
  },
): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "kid";
  row.dataset["act"] = `goto:${item.id}`;
  row.title = item.title;
  const icon = document.createElement("span");
  icon.className = `ic ${item.kind}`;
  icon.append(shellIcon(item.kind));
  if (item.place !== undefined) {
    row.append(textOf("span", "meta", String(item.place)));
  }
  row.append(icon, textOf("span", "nm", item.title));
  return row;
}

/** The rows of a station's Contents or of a story's Entries, numbered. */
export function entriesList(
  entries: readonly Parameters<typeof rowOf>[0][],
): HTMLElement {
  const list = document.createElement("div");
  list.className = "kids";
  list.append(...entries.map(rowOf));
  return list;
}

/** The fold's body: the rows, or a line saying there are none, then `add`
 *  and how else to add. */
export function contentsBody(
  items: readonly StationContent[],
  add: HTMLElement,
): HTMLElement[] {
  return [
    items.length === 0
      ? textOf("div", "note", "Nothing at this station yet.")
      : entriesList(items),
    add,
    textOf(
      "div",
      "note",
      "The same menu as the + on the station's row in the list.",
    ),
  ];
}
