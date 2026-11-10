/**
 * The 3D view's tree dock, drawn from its model (`tree-model.ts`) as a
 * file explorer draws one: a row per station (its grip, its fold arrow,
 * its number and name, a mark when it is unlocked, its count when
 * folded), unfolded its picture, its story folders (a story's fold arrow,
 * its name, its count and its "+", and when open its numbered entries), its
 * plain folders (a fold arrow, a name, a count and a pen, and when open
 * their items on a guide line) and its other free items, then the codes
 * and the layer chips. In the Select mode each item's and folder's row
 * shows a checkbox.
 * Everything from the tour is set as text, never as markup. Every control
 * is a button (a card's row, its fold arrow, a folder's arrow and name, an
 * item's and a code's row, a header, a chip), none inside another, so the
 * tree works from the
 * keyboard; a draw keeps the focus on the control that had it. The clicks
 * are the shell's (`editor-shell.ts`), read from the drawn elements' data:
 *
 * - `data-select` - a card's row, an item's or a code's row: the
 *   page's selection id it selects;
 * - `data-unfold` - a card's fold button: the station's id;
 * - `data-folder` - a story's fold arrow: the story's id;
 * - `data-section` - a section's header: the section it folds;
 * - `data-layer` - a chip: the layer it turns on or off;
 * - `data-drag` - a card's grip (no button): the station it drags
 *   (`tree-drag.ts`); none while a search runs - the grip is `off`;
 * - `data-add` - a card's "+", `data-fill` - its empty line's "Add
 *   content": the station the type menu adds to (`tree-add-menu.ts`);
 * - `data-storyadd` - a story's "+", `data-storyfill` - its empty line's
 *   "Add the first entry": the story the type menu adds to;
 * - `data-move` - an item's or a story's grip (no button): the row it
 *   drags (`tree-nest-drag.ts`); none while a search runs;
 * - `data-list` and `data-item` - an item's or a story's row: the list
 *   it stands in (`free`, `story:<id>`, `stories`) and its id there;
 * - `data-into` - a row a drop goes into: a story's row and its empty
 *   line (`story:<id>`), a plain folder's row and its empty line
 *   (`folder:<id>`), a station's row (`free`, its free items);
 * - `data-pfold` - a plain folder's fold arrow: the folder's id;
 * - `data-rename` - a plain folder's pen: the folder it renames;
 *   `data-ren` - the name field that replaces its name meanwhile.
 *
 * @see shell-tree.ts.md
 */
import type { ShellPictures } from "./shell-pictures.js";
import { shellIcon } from "gps-plus-slam-editor-kit/chrome";
import type {
  TreeCard,
  TreeChild,
  TreeFolder,
  TreeModel,
  TreePlainFolder,
} from "./tree-model.js";
import { FOLDER_PREFIX } from "../editor-model.js";
import type { TreeSection } from "../editor-view.js";
import {
  FREE_LIST,
  STORIES_LIST,
  storyList,
} from "../../station-children-moves.js";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

function button(className: string): HTMLButtonElement {
  const made = el("button", className);
  made.type = "button";
  return made;
}

/** The data attributes a control of the tree is known by across draws. */
const KEYS = [
  "select",
  "unfold",
  "folder",
  "section",
  "layer",
  "add",
  "fill",
  "storyadd",
  "storyfill",
  "pfold",
  "rename",
  "ren",
] as const;

type ControlKey = (typeof KEYS)[number];

/** Which control of `body` has the focus, by its data, or null. */
function focusedControl(
  body: HTMLElement,
): { key: ControlKey; value: string } | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !body.contains(active)) return null;
  for (const key of KEYS) {
    const value = active.dataset[key];
    if (value !== undefined) return { key, value };
  }
  return null;
}

/** The control of `body` known by `control`, or none. */
function controlOf(
  body: HTMLElement,
  control: { key: ControlKey; value: string },
): HTMLElement | undefined {
  return [...body.querySelectorAll<HTMLElement>(`[data-${control.key}]`)].find(
    (e) => e.dataset[control.key] === control.value,
  );
}

/** The line on how to group, one for a mouse and one for a finger (the
 *  style shows the one that fits the screen's pointer). */
function groupHint(): HTMLElement {
  const hint = el("div", "hint");
  const words = (className: string, parts: readonly (string | [string])[]) => {
    const line = el("span", className);
    for (const part of parts) {
      line.append(typeof part === "string" ? part : el("b", "", part[0]));
    }
    return line;
  };
  hint.append(
    words("fine", [
      "To group: Ctrl+click or Shift+click a few items, then ",
      ["Group"],
      " (Ctrl+G).",
    ]),
    words("coarse", [
      "To group: tap ",
      ["Select"],
      " (or long-press a row), tick a few items, then ",
      ["Group"],
      ".",
    ]),
  );
  return hint;
}

/** A section's header button: its fold arrow, its name and its count. */
function sectionHeader(
  head: HTMLButtonElement,
  section: TreeSection,
  label: string,
  open: boolean,
  count: number | null,
): HTMLButtonElement {
  head.dataset["section"] = section;
  head.setAttribute("aria-expanded", String(open));
  const parts: Node[] = [
    shellIcon(open ? "down" : "right"),
    el("span", "", label),
  ];
  if (count !== null) parts.push(el("span", "count", String(count)));
  head.replaceChildren(...parts);
  return head;
}

/** The grip an item or a story is dragged by within its station
 *  (`tree-nest-drag.ts`): no button - the inspector's Move to, Earlier
 *  and Later are the keyboard's way. None while a search runs: a drop
 *  would place it among rows the search hides. */
function moveGrip(id: string): HTMLElement {
  const grip = el("span", "grip");
  grip.dataset["move"] = id;
  grip.title = "Drag to move it in its station";
  grip.setAttribute("aria-hidden", "true");
  grip.append(shellIcon("grip"));
  return grip;
}

/** The Select mode's checkbox of a row (shown only in that mode): a mark;
 *  the row's own `aria-pressed` says whether it is picked. */
function checkbox(on: boolean): HTMLElement {
  const box = el("span", on ? "cb on" : "cb");
  box.setAttribute("aria-hidden", "true");
  box.append(shellIcon("check"));
  return box;
}

/** An item's row: its kind's icon, its name and, for a story's entry, its
 *  place; in `list` (a story's or a plain folder's, deeper, or the free
 *  items). A plain folder's items stand on its guide line, the last one
 *  ending it. */
function childOf(
  child: TreeChild,
  list: string,
  searching: boolean,
  last = false,
): HTMLButtonElement {
  const inFolder = list.startsWith(FOLDER_PREFIX);
  const row = button(
    list === FREE_LIST
      ? "kid"
      : inFolder
        ? `kid deep infolder${last ? " last" : ""}`
        : "kid deep",
  );
  row.classList.toggle("sel", child.selected);
  row.setAttribute("aria-pressed", String(child.selected));
  row.dataset["select"] = child.id;
  row.dataset["list"] = list;
  row.dataset["item"] = child.id;
  if (!searching) row.append(moveGrip(child.id));
  const icon = el("span", `ic ${child.kind}`);
  icon.append(shellIcon(child.kind));
  row.append(icon, el("span", "nm", child.title));
  if (child.place !== undefined) {
    row.append(el("span", "meta", String(child.place)));
  }
  if (list === FREE_LIST || inFolder) row.append(checkbox(child.selected));
  return row;
}

/** The name field of a plain folder being renamed, its text as typed. */
export interface TreeRenaming {
  readonly id: string;
  readonly text: string;
}

/** A plain folder's row (its grip, its arrow, its name or, being renamed,
 *  the name field, its count, its pen and its checkbox: none inside
 *  another) and, open, its items or the line that says it has none. */
function plainFolderRows(
  folder: TreePlainFolder,
  searching: boolean,
  renaming: TreeRenaming | null,
): HTMLElement[] {
  const into = `${FOLDER_PREFIX}${folder.id}`;
  const row = el("div", "folder gfolder");
  row.classList.toggle("sel", folder.selected);
  row.classList.toggle("ctx", folder.context);
  row.dataset["plainfolder"] = folder.id;
  row.dataset["list"] = FREE_LIST;
  row.dataset["item"] = folder.id;
  row.dataset["into"] = into;
  if (!searching) row.append(moveGrip(folder.id));
  const fold = button("tw");
  fold.dataset["pfold"] = folder.id;
  fold.setAttribute("aria-expanded", String(folder.open));
  fold.title = folder.open
    ? "Hide the folder's items"
    : "Show the folder's items";
  fold.setAttribute("aria-label", fold.title);
  fold.append(shellIcon(folder.open ? "down" : "right"));
  row.append(fold);
  const icon = el("span", "ic fold");
  icon.append(shellIcon("folder"));
  if (renaming?.id === folder.id) {
    const box = el("span", "fname");
    const field = el("input", "renin");
    field.type = "text";
    field.value = renaming.text;
    field.dataset["ren"] = folder.id;
    field.setAttribute("aria-label", "The folder's name");
    box.append(icon, field);
    row.append(box);
  } else {
    const pick = button("fname");
    pick.dataset["select"] = folder.selection;
    pick.title = `${folder.title} (a folder: a group in the scene)`;
    pick.setAttribute("aria-pressed", String(folder.selected));
    pick.append(icon, el("span", "nm", folder.title));
    const count = el(
      "span",
      "meta",
      folder.count === 1 ? "1 item" : `${String(folder.count)} items`,
    );
    const pen = button("ren");
    pen.dataset["rename"] = folder.id;
    pen.title = "Rename (F2)";
    pen.setAttribute("aria-label", `Rename "${folder.title}"`);
    pen.append(shellIcon("pencil"));
    row.append(pick, count, pen, checkbox(folder.selected));
  }
  if (!folder.open) return [row];
  if (folder.children.length > 0) {
    const n = folder.children.length;
    return [
      row,
      ...folder.children.map((c, i) => {
        const kid = childOf(c, into, searching, i === n - 1);
        // A selected folder carries its items: they wear its band.
        kid.classList.toggle("ctx", folder.selected && !c.selected);
        return kid;
      }),
    ];
  }
  if (folder.count > 0) return [row];
  const empty = el("div", "emptyrow deep infolder", "Empty - drag items here");
  empty.dataset["into"] = into;
  return [row, empty];
}

/** A story's row (its arrow, its name, its count, its "+": none inside
 *  another) and, when it is open, its entries under it, or the line that
 *  says it has none. */
function folderOf(folder: TreeFolder, searching: boolean): HTMLElement[] {
  const row = el("div", "folder");
  row.classList.toggle("sel", folder.selected);
  row.classList.toggle("ctx", folder.context);
  row.dataset["story"] = folder.id;
  row.dataset["list"] = STORIES_LIST;
  row.dataset["item"] = folder.id;
  row.dataset["into"] = storyList(folder.id);
  if (!searching) row.append(moveGrip(folder.id));
  const fold = button("tw");
  fold.dataset["folder"] = folder.id;
  fold.setAttribute("aria-expanded", String(folder.open));
  fold.title = folder.open ? "Hide the entries" : "Show the entries";
  fold.setAttribute("aria-label", fold.title);
  fold.append(shellIcon(folder.open ? "down" : "right"));
  const pick = button("fname");
  pick.dataset["select"] = folder.selection;
  pick.title = folder.title;
  pick.setAttribute("aria-pressed", String(folder.selected));
  const icon = el("span", "ic story");
  icon.append(shellIcon(folder.open ? "storyOpen" : "story"));
  pick.append(icon, el("span", "nm", folder.title));
  const add = button("ib add");
  add.dataset["storyadd"] = folder.id;
  add.title = `Add an entry to the story "${folder.title}"`;
  add.setAttribute("aria-label", add.title);
  add.setAttribute("aria-haspopup", "menu");
  add.setAttribute("aria-expanded", "false");
  add.append(shellIcon("plus"));
  row.append(fold, pick, el("span", "meta", String(folder.count)), add);
  if (!folder.open) return [row];
  if (folder.children.length > 0 || folder.count > 0) {
    const list = storyList(folder.id);
    return [row, ...folder.children.map((c) => childOf(c, list, searching))];
  }
  const empty = el("div", "emptyrow deep", "No entries yet. ");
  empty.dataset["into"] = storyList(folder.id);
  const fill = button("fill");
  fill.dataset["storyfill"] = folder.id;
  fill.textContent = "Add the first entry";
  fill.setAttribute("aria-label", add.title);
  fill.setAttribute("aria-haspopup", "menu");
  empty.append(fill);
  return [row, empty];
}

function cardOf(
  card: TreeCard,
  pictures: ShellPictures,
  searching: boolean,
  renaming: TreeRenaming | null,
): HTMLElement {
  const box = el("div", "card");
  box.classList.toggle("sel", card.selected);
  box.classList.toggle("ctx", card.context);
  // Unfolded, the station is no longer one compact line: its name wraps.
  box.classList.toggle("open", card.open);
  box.dataset["station"] = card.id;
  // The station's one-line row: the grip and the fold arrow, its button
  // (the number chip, then the name beside it, cut with an ellipsis),
  // then its marks - none inside another.
  const head = el("div", "head");
  // A drop on the station's row: out of a story, among its free items.
  head.dataset["into"] = FREE_LIST;
  const pick = button("pick");
  pick.dataset["select"] = card.selection;
  pick.title = card.title;
  pick.setAttribute("aria-pressed", String(card.selected));
  const fold = button("tw");
  fold.dataset["unfold"] = card.id;
  fold.setAttribute("aria-expanded", String(card.open));
  fold.title = card.open ? "Hide the items" : "Show the items";
  fold.setAttribute("aria-label", fold.title);
  fold.append(shellIcon(card.open ? "down" : "right"));
  pick.append(
    el("span", "n", String(card.number)),
    el("span", "nm", card.title),
  );
  // The grip a card is dragged by (`tree-drag.ts`): no button - the
  // inspector's Earlier and Later are the keyboard's way to reorder.
  // While a search hides stations it drags nothing: a drop would order
  // the hidden ones unseen.
  const grip = el("span", searching ? "grip off" : "grip");
  if (searching) grip.title = "Clear the search to change the order";
  else {
    grip.dataset["drag"] = card.id;
    grip.title = "Drag to change its place in the tour";
  }
  grip.setAttribute("aria-hidden", "true");
  grip.append(shellIcon("grip"));
  head.append(grip, fold, pick);
  if (card.unlocked) {
    // Every station starts locked: the row marks the one that is not.
    const mark = el("span", "lockg");
    mark.title = "Its position is unlocked: it can be moved";
    mark.append(shellIcon("unlock"));
    head.append(mark);
  }
  if (!card.open && card.count > 0) {
    const count = el("span", "meta", String(card.count));
    count.title = card.count === 1 ? "1 item" : `${String(card.count)} items`;
    head.append(count);
  }
  // Its last piece: the "+" that adds in place (the type menu).
  const add = button("ib add");
  add.dataset["add"] = card.id;
  add.title = `Add to "${card.title}"`;
  add.setAttribute("aria-label", add.title);
  add.setAttribute("aria-haspopup", "menu");
  add.setAttribute("aria-expanded", "false");
  add.append(shellIcon("plus"));
  head.append(add);
  box.append(head);
  if (card.open) {
    // Unfolded: its picture (only when it has one), then its story
    // folders and its free items below the row.
    if (card.imagePath !== null) {
      const pic = el("div", "pic");
      pic.dataset["select"] = card.selection;
      pic.setAttribute("aria-hidden", "true");
      pictures.show(pic, card.imagePath);
      box.append(pic);
    }
    const kids = el("div", "kids");
    for (const folder of card.folders) {
      kids.append(...folderOf(folder, searching));
    }
    for (const folder of card.groups) {
      kids.append(...plainFolderRows(folder, searching, renaming));
    }
    for (const child of card.children) {
      kids.append(childOf(child, FREE_LIST, searching));
    }
    if (
      card.folders.length === 0 &&
      card.groups.length === 0 &&
      card.children.length === 0
    ) {
      const empty = el("div", "emptyrow", "Nothing here yet. ");
      const fill = button("fill");
      fill.dataset["fill"] = card.id;
      fill.textContent = "Add content";
      fill.setAttribute("aria-label", `Add content to "${card.title}"`);
      fill.setAttribute("aria-haspopup", "menu");
      empty.append(fill);
      kids.append(empty);
    }
    box.append(kids);
  }
  return box;
}

/** How the rows are drawn beyond the model: the folder being renamed,
 *  the Select mode (checkboxes), and whether the line on how to group
 *  shows (nothing picked). */
export interface TreeRowsState {
  readonly renaming?: TreeRenaming | null;
  readonly selectMode?: boolean;
  readonly groupHint?: boolean;
}

/**
 * The dock drawn from `tree`: the stations' header (`stationsHead`, in the
 * dock's head beside its fold button) and the body's cards, codes and
 * chips; `folded` folds the dock to its head.
 */
export function drawTree(
  dock: {
    readonly root: HTMLElement;
    readonly stationsHead: HTMLButtonElement;
    readonly fold: HTMLButtonElement;
    readonly body: HTMLElement;
  },
  tree: TreeModel,
  folded: boolean,
  pictures: ShellPictures,
  rows: TreeRowsState = {},
): void {
  const focused = focusedControl(dock.body);
  const renaming = rows.renaming ?? null;
  dock.body.classList.toggle("selmode", rows.selectMode === true);
  dock.root.classList.toggle("collapsed", folded);
  dock.fold.replaceChildren(shellIcon(folded ? "down" : "up"));
  dock.fold.title = folded ? "Show the panel" : "Collapse the panel";
  dock.fold.setAttribute("aria-label", dock.fold.title);
  dock.fold.setAttribute("aria-expanded", String(!folded));
  sectionHeader(
    dock.stationsHead,
    "stations",
    "Stations",
    tree.sections.stations,
    tree.stationCount,
  );
  const parts: Node[] = [];
  if (tree.query !== "" && tree.cards.length === 0 && tree.codes.length === 0) {
    parts.push(el("div", "nomatch", `Nothing matches "${tree.query}".`));
  }
  if (tree.sections.stations) {
    const cards = el("div", "cards");
    for (const card of tree.cards)
      cards.append(cardOf(card, pictures, tree.query !== "", renaming));
    parts.push(cards);
    if (rows.groupHint === true && tree.cards.length > 0) {
      parts.push(groupHint());
    }
  }
  const codesHead = el("div", "sec");
  codesHead.append(
    sectionHeader(
      button("sech"),
      "codes",
      "Codes",
      tree.sections.codes,
      tree.codes.length,
    ),
  );
  parts.push(codesHead);
  if (tree.sections.codes) {
    for (const code of tree.codes) {
      const row = button("row");
      row.classList.toggle("sel", code.selected);
      row.setAttribute("aria-pressed", String(code.selected));
      row.dataset["select"] = code.id;
      row.title = code.meta;
      const icon = el("span", "ic code");
      icon.append(shellIcon("qr"));
      row.append(icon, el("span", "nm", code.title));
      parts.push(row);
    }
  }
  const layersHead = el("div", "sec");
  layersHead.append(
    sectionHeader(
      button("sech"),
      "layers",
      "Visible layers",
      tree.sections.layers,
      null,
    ),
  );
  parts.push(layersHead);
  if (tree.sections.layers) {
    const chips = el("div", "layers");
    for (const chip of tree.chips) {
      const toggle = button("chip");
      toggle.classList.toggle("on", chip.on);
      toggle.dataset["layer"] = chip.layer;
      toggle.setAttribute("aria-pressed", String(chip.on));
      toggle.append(el("i", ""), chip.label);
      chips.append(toggle);
    }
    parts.push(chips);
  }
  dock.body.replaceChildren(...parts);
  if (focused !== null) controlOf(dock.body, focused)?.focus();
}

/** The selection bar's model (`../folder-commands.ts` `selectionBarOf`). */
interface SelectionBarModel {
  readonly show: boolean;
  readonly count: number;
  readonly group: boolean;
  readonly ungroup: boolean;
  readonly done: boolean;
  readonly why: string | null;
}

/**
 * The picked rows' bar under the tree: their count, Group (the primary
 * one), Ungroup and, in the Select mode, Done, then the line on why Group
 * is off; hidden when it has nothing to act on. A button that cannot act
 * is disabled, never left out, so the bar keeps its shape as rows are
 * ticked. Its clicks are the shell's: `data-selbar` (`group`, `ungroup`,
 * `done`).
 */
export function drawSelectionBar(
  bar: HTMLElement,
  model: SelectionBarModel,
): void {
  bar.hidden = !model.show;
  if (!model.show) {
    bar.replaceChildren();
    return;
  }
  const focused =
    document.activeElement instanceof HTMLElement &&
    bar.contains(document.activeElement)
      ? (document.activeElement.dataset["selbar"] ?? null)
      : null;
  const act = (
    what: string,
    icon: "folder" | "outdent" | "check",
    label: string,
    on: boolean,
    primary = false,
  ) => {
    const b = button(primary ? "abtn primary" : "abtn");
    b.dataset["selbar"] = what;
    b.disabled = !on;
    b.append(shellIcon(icon), el("span", "", label));
    return b;
  };
  const parts: HTMLElement[] = [
    el(
      "span",
      "cnt",
      model.count === 0 ? "Tick rows" : `${String(model.count)} selected`,
    ),
    act("group", "folder", "Group", model.group, true),
    act("ungroup", "outdent", "Ungroup", model.ungroup),
  ];
  if (model.done) parts.push(act("done", "check", "Done", true));
  if (model.why !== null) parts.push(el("span", "why", model.why));
  bar.replaceChildren(...parts);
  if (focused !== null) {
    bar.querySelector<HTMLElement>(`[data-selbar="${focused}"]`)?.focus();
  }
}
