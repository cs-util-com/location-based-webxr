/**
 * The 3D view's tree dock, drawn from its model (`tree-model.ts`): the
 * stations' story cards with their items, the codes and the layer chips.
 * Everything from the tour is set as text, never as markup. The clicks
 * are the shell's (`editor-shell.ts`), read from the drawn elements' data:
 *
 * - `data-select` - a card's picture, an item's or a code's row: the
 *   page's selection id it selects;
 * - `data-unfold` - a card's fold button: the station's id;
 * - `data-section` - a section's header: the section it folds;
 * - `data-layer` - a chip: the layer it turns on or off.
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

/** A section's header button: its fold arrow, its name and its count. */
function sectionHeader(
  button: HTMLButtonElement,
  section: TreeSection,
  label: string,
  open: boolean,
  count: number | null,
): HTMLButtonElement {
  button.dataset["section"] = section;
  button.setAttribute("aria-expanded", String(open));
  const parts: Node[] = [
    shellIcon(open ? "down" : "right"),
    el("span", "", label),
  ];
  if (count !== null) parts.push(el("span", "count", String(count)));
  button.replaceChildren(...parts);
  return button;
}

function cardOf(card: TreeCard, pictures: ShellPictures): HTMLElement {
  const box = el("div", "card");
  box.classList.toggle("sel", card.selected);
  box.classList.toggle("ctx", card.context);
  box.dataset["station"] = card.id;
  const hero = el("div", "hero");
  hero.classList.toggle("nodesc", card.description === null);
  hero.dataset["select"] = card.selection;
  hero.title = card.title;
  if (card.imagePath !== null) pictures.show(hero, card.imagePath);
  const fold = el("button", "tw");
  fold.type = "button";
  fold.dataset["unfold"] = card.id;
  fold.setAttribute("aria-expanded", String(card.open));
  fold.title = card.open ? "Hide the items" : "Show the items";
  fold.setAttribute("aria-label", fold.title);
  fold.append(shellIcon(card.open ? "down" : "right"));
  hero.append(
    el("span", "n", String(card.number)),
    fold,
    el("span", "nm", card.title),
  );
  if (card.description !== null) {
    hero.append(el("span", "ds", card.description));
  }
  box.append(hero);
  if (card.open) {
    const kids = el("div", "kids");
    for (const child of card.children) {
      const row = el("div", "kid");
      row.classList.toggle("sel", child.selected);
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
      el("button", "sech"),
      "codes",
      "Codes",
      tree.sections.codes,
      tree.codes.length,
    ),
  );
  parts.push(codesHead);
  if (tree.sections.codes) {
    for (const code of tree.codes) {
      const row = el("div", "row");
      row.classList.toggle("sel", code.selected);
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
      el("button", "sech"),
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
      const button = el("button", "chip");
      button.type = "button";
      button.classList.toggle("on", chip.on);
      button.dataset["layer"] = chip.layer;
      button.setAttribute("aria-pressed", String(chip.on));
      button.append(el("i", ""), chip.label);
      chips.append(button);
    }
    parts.push(chips);
  }
  for (const b of parts.flatMap((p) =>
    p instanceof HTMLElement ? [...p.querySelectorAll("button.sech")] : [],
  )) {
    (b as HTMLButtonElement).type = "button";
  }
  dock.body.replaceChildren(...parts);
}
