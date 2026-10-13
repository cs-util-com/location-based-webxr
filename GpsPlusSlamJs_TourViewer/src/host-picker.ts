/**
 * The host tiles of step 1 (polish round M2, A6/A7): one radio tile per
 * host, the chosen host's own steps below them, the starter zip only for a
 * host that needs a file before it gives a link, and a Continue that hands
 * over to step 2. The choice is stored (`tour-host.ts`), so a returning
 * creator finds it selected.
 *
 * The DOM surface is structural, like the wizard's, so the unit tests run
 * in node with plain objects.
 *
 * @see host-picker.ts.md
 */

import {
  TOUR_HOSTS,
  hostStepParts,
  needsStarterZip,
  readTourHost,
  writeTourHost,
  type TourHost,
  type TourHostStore,
} from "./tour-host.js";

/** `HTMLElement["hidden"]`: a boolean, or "until-found" in newer DOM libs. */
type Hidden = HTMLElement["hidden"];

interface PickerNode<T> {
  hidden: Hidden;
  replaceChildren(...nodes: T[]): void;
}

/** A node the picker creates: a tile, a list item, a text run or a link.
 *  Generic in itself so the steps' list items can hold the others. */
interface TileNode<T> {
  textContent: string | null;
  replaceChildren(...nodes: T[]): void;
  /** A button's type; a text run has none. */
  type?: string;
  className: string;
  readonly dataset: Record<string, string | undefined>;
  setAttribute(name: string, value: string): void;
  addEventListener(type: "click", fn: () => void): void;
}

interface ClickableNode {
  hidden: Hidden;
  addEventListener(type: "click", fn: () => void): void;
}

export interface HostPickerDom<T> {
  /** The group the toggle tiles are rendered into. */
  tiles: PickerNode<T>;
  /** The chosen host's steps (an `<ol>`); hidden until a choice. */
  steps: PickerNode<T>;
  /** The starter zip button; its click is the wizard's. */
  starter: { hidden: Hidden };
  continueButton: ClickableNode;
}

export function wireHostPicker<T extends TileNode<T>>(deps: {
  dom: HostPickerDom<T>;
  store: TourHostStore | undefined;
  /** `document.createElement`, injectable for the tests. */
  createElement: (tag: "button" | "li" | "span" | "a") => T;
  /** Continue was tapped with a host chosen. */
  onContinue: (host: TourHost) => void;
}): void {
  const { dom, store, createElement } = deps;
  // Held here as well as in the store: a store that throws must not lose
  // the choice for this page.
  let chosen: TourHost | null = readTourHost(store);

  const tiles = TOUR_HOSTS.map(({ id, label }) => {
    const tile = createElement("button");
    tile.type = "button";
    tile.className = "btn btn--prose host-tile";
    tile.textContent = label;
    tile.dataset.host = id;
    // Toggle buttons, not radios (PR #585 review): a second tap lets the
    // choice go (P6), which a radio cannot do, and a radiogroup promises
    // arrow keys and one tab stop these never had.
    tile.addEventListener("click", () => {
      // A second tap on the chosen host lets it go (prototype verdict P6).
      chosen = chosen === id ? null : id;
      writeTourHost(store, chosen);
      render();
    });
    return { id, tile };
  });
  dom.tiles.replaceChildren(...tiles.map((t) => t.tile));

  function render(): void {
    for (const { id, tile } of tiles) {
      tile.setAttribute("aria-pressed", String(id === chosen));
    }
    if (chosen === null) {
      dom.steps.hidden = true;
      dom.starter.hidden = true;
      dom.continueButton.hidden = true;
      return;
    }
    const items = hostStepParts(chosen).map((parts) => {
      const li = createElement("li");
      li.replaceChildren(
        ...parts.map((part) => {
          if (part.href === undefined) {
            const run = createElement("span");
            run.textContent = part.text;
            return run;
          }
          // The host in a new tab: the setup page keeps its place.
          const link = createElement("a");
          link.textContent = part.text;
          link.setAttribute("href", part.href);
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noopener");
          return link;
        }),
      );
      return li;
    });
    dom.steps.replaceChildren(...items);
    dom.steps.hidden = false;
    dom.starter.hidden = !needsStarterZip(chosen);
    dom.continueButton.hidden = false;
  }

  dom.continueButton.addEventListener("click", () => {
    if (chosen !== null) deps.onContinue(chosen);
  });
  render();
}
