/**
 * The 3D view's tree dock, drawn from its model (`tree-model.ts`): the
 * stations' story cards with their items, the codes and the layer chips.
 * Everything from the tour is set as text, never as markup. Every control
 * is a button (a card's picture, its fold arrow, an item's and a code's
 * row, a header, a chip), none inside another, so the tree works from the
 * keyboard; a draw keeps the focus on the control that had it. The clicks
 * are the shell's (`editor-shell.ts`), read from the drawn elements' data:
 *
 * - `data-select` - a card's picture, an item's or a code's row: the
 *   page's selection id it selects;
 * - `data-unfold` - a card's fold button: the station's id;
 * - `data-section` - a section's header: the section it folds;
 * - `data-layer` - a chip: the layer it turns on or off;
 * - `data-drag` - a card's grip (no button): the station it drags
 *   (`tree-drag.ts`).
 *
 * @see shell-tree.ts.md
 */
import type { ShellPictures } from "./shell-pictures.js";
import { shellIcon } from "./shell-icons.js";
import type { TreeCard, TreeModel } from "./tree-model.js";
import type { TreeSection } from "../editor-view.js";

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
const KEYS = ["select", "unfold", "section", "layer"] as const;

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

function cardOf(card: TreeCard, pictures: ShellPictures): HTMLElement {
  const box = el("div", "card");
  box.classList.toggle("sel", card.selected);
  box.classList.toggle("ctx", card.context);
  box.dataset["station"] = card.id;
  const hero = el("div", "hero");
  hero.classList.toggle("nodesc", card.description === null);
  if (card.imagePath !== null) pictures.show(hero, card.imagePath);
  // The picture is a button over the whole hero; the fold arrow sits
  // beside it, never inside it.
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
  if (card.description !== null) {
    pick.append(el("span", "ds", card.description));
  }
  // The grip a card is dragged by (`tree-drag.ts`): no button - the
  // inspector's Earlier and Later are the keyboard's way to reorder.
  const grip = el("span", "grip");
  grip.dataset["drag"] = card.id;
  grip.title = "Drag to change its place in the tour";
  grip.setAttribute("aria-hidden", "true");
  grip.append(shellIcon("grip"));
  hero.append(pick, grip, fold);
  box.append(hero);
  if (card.open) {
    const kids = el("div", "kids");
    for (const child of card.children) {
      const row = button("kid");
      row.classList.toggle("sel", child.selected);
      row.setAttribute("aria-pressed", String(child.selected));
      row.dataset["select"] = child.id;
      const icon = el("span", `ic ${child.kind}`);
      icon.append(shellIcon(child.kind));
      row.append(icon, el("span", "nm", child.title));
      kids.append(row);
    }
    if (card.children.length === 0) {
      kids.append(el("div", "kid empty", "No items yet."));
    }
    box.append(kids);
  }
  return box;
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
): void {
  const focused = focusedControl(dock.body);
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
  if (tree.sections.stations) {
    const cards = el("div", "cards");
    for (const card of tree.cards) cards.append(cardOf(card, pictures));
    parts.push(cards);
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
