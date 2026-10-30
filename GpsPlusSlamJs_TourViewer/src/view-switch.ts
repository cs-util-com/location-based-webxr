/**
 * The visitor's view switch (station blocks design §4, the prototype's
 * `#vswitch`): inside a station, on a block whose creator's view is in an
 * interchangeable set, a pill names the view shown; its menu lists the
 * set's members, greys a member whose needs fail with the reason, marks
 * the creator's choice, and offers "Use the creator's choice again" while
 * a choice is stored. The page owns storage and the toast (`choose`,
 * `say`); this module owns the model and the DOM.
 *
 * @see view-switch.ts.md
 */

import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";

import "./view-switch.css";
import {
  preferredView,
  shownView,
  viewNeedsFail,
  viewSetOf,
  type ViewPlacement,
} from "./visitor-prefs.js";

/** What each member is called, and its one line (the prototype's copy,
 *  without the narration it does not have here). */
const VIEW_COPY: Readonly<Record<string, { label: string; line: string }>> = {
  reading: {
    label: "Reading",
    line: "The whole text in a sheet, read at your own pace",
  },
  lectern: {
    label: "Lectern",
    line: "A reading stand in place, read up close",
  },
};

/** What a kind is called in the toast ("for every long text"). */
const KIND_NOUN: Readonly<Record<string, string>> = { longText: "long text" };

const CREATOR_TAG = "creator's choice";

interface ViewSwitchRow {
  readonly view: string;
  readonly label: string;
  readonly line: string;
  /** "creator's choice", the reason the member cannot show this block
   *  (then `disabled`), both, or empty. */
  readonly tag: string;
  readonly disabled: boolean;
  /** The member shown now. */
  readonly on: boolean;
}

export interface ViewSwitchModel {
  readonly kind: string;
  readonly placement: ViewPlacement;
  /** The label of the view shown now. */
  readonly current: string;
  /** Whether the device holds a choice for this kind and placement. */
  readonly chosen: boolean;
  readonly rows: readonly ViewSwitchRow[];
}

function labelOf(view: string): string {
  return VIEW_COPY[view]?.label ?? view;
}

function nounOf(kind: string): string {
  return KIND_NOUN[kind] ?? kind;
}

/**
 * The switch for a station's blocks, or null when none is in a set. The
 * FIRST block in a set describes it; a choice applies to every block of
 * that kind at that placement, each through `shownView`.
 */
export function viewSwitchModel(
  blocks: readonly TourBlock[],
  stored: unknown,
): ViewSwitchModel | null {
  for (const block of blocks) {
    const set = viewSetOf(block.kind, block.view);
    if (set === null) continue;
    const shown = shownView({ audience: "visitor", block, stored });
    return {
      kind: block.kind,
      placement: set.placement,
      current: labelOf(shown),
      chosen: preferredView(stored, block.kind, set.placement) !== null,
      rows: set.members.map((view) => {
        const fail = viewNeedsFail(block, view);
        const tags = view === block.view ? [CREATOR_TAG] : [];
        if (fail !== null) tags.push(fail);
        return {
          view,
          label: labelOf(view),
          line: VIEW_COPY[view]?.line ?? "",
          tag: tags.join(", "),
          disabled: fail !== null,
          on: view === shown,
        };
      }),
    };
  }
  return null;
}

export interface ViewSwitchDeps {
  /** Where the switch is mounted (the AR overlay root). */
  readonly host: HTMLElement;
  /** The present station's free blocks (empty outside a station) and
   *  the stored preference. */
  read(): { readonly blocks: readonly TourBlock[]; readonly stored: unknown };
  /** Stores a choice (null: the creator's again); returns whether the
   *  device keeps it (false: it lasts the visit). */
  choose(kind: string, placement: ViewPlacement, view: string | null): boolean;
  /** Tells the visitor what happened (the walk's toast). */
  say(text: string): void;
}

export interface ViewSwitch {
  /** Re-reads `read()` and redraws only when the model changed; cheap
   *  enough for every frame. */
  sync(): void;
  dispose(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function listIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M4 7h16M4 12h16M4 17h10");
  svg.append(path);
  return svg;
}

export function createViewSwitch(deps: ViewSwitchDeps): ViewSwitch {
  const root = el("div", "view-switch");
  root.dataset.testid = "view-switch";
  root.hidden = true;
  const button = el("button", "vs-btn");
  button.type = "button";
  button.dataset.testid = "view-switch-button";
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  const current = el("span");
  current.dataset.testid = "view-switch-current";
  button.append(listIcon(), current, el("small", undefined, "change"));
  const menu = el("div", "vs-menu");
  menu.dataset.testid = "view-switch-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  root.append(button, menu);
  deps.host.append(root);

  let model: ViewSwitchModel | null = null;
  let drawnKey = "";

  function setOpen(open: boolean): void {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  function pick(view: string | null): void {
    if (model === null) return;
    const { kind, placement } = model;
    const kept = deps.choose(kind, placement, view);
    setOpen(false);
    sync();
    const label = model?.current ?? labelOf(view ?? "");
    let text: string;
    if (view === null) text = `Back to the creator's choice: ${label}.`;
    else if (kept) {
      text = `${label} from now on, for every ${nounOf(kind)} on this phone.`;
    } else {
      text = `${label} for this visit (this browser does not keep the choice).`;
    }
    deps.say(text);
  }

  function draw(next: ViewSwitchModel): void {
    current.textContent = next.current;
    const rows = next.rows.map((row) => {
      const item = el("button", row.on ? "vo on" : "vo");
      item.type = "button";
      item.dataset.testid = `view-switch-${row.view}`;
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(row.on));
      item.disabled = row.disabled;
      const head = el("b", undefined, row.label);
      if (row.tag !== "") head.append(el("i", undefined, row.tag));
      item.append(head, el("span", undefined, row.line));
      item.addEventListener("click", () => {
        if (!item.disabled) pick(row.view);
      });
      return item;
    });
    const foot = el(
      "div",
      "vs-foot",
      `Your choice is kept on this phone for every ${nounOf(next.kind)}, in every tour.`,
    );
    if (next.chosen) {
      const reset = el("button", undefined, "Use the creator's choice again");
      reset.type = "button";
      reset.dataset.testid = "view-switch-reset";
      reset.addEventListener("click", () => {
        pick(null);
      });
      foot.append(reset);
    }
    menu.replaceChildren(...rows, foot);
  }

  function sync(): void {
    const { blocks, stored } = deps.read();
    model = viewSwitchModel(blocks, stored);
    const key = model === null ? "" : JSON.stringify(model);
    if (key === drawnKey) return;
    drawnKey = key;
    if (model === null) {
      setOpen(false);
      root.hidden = true;
      return;
    }
    root.hidden = false;
    draw(model);
  }

  const onButton = (): void => {
    setOpen(button.getAttribute("aria-expanded") !== "true");
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !menu.hidden) {
      setOpen(false);
      button.focus();
    }
  };
  // A tap anywhere else closes the open menu (sideways it covers the
  // walk's card).
  const doc = deps.host.ownerDocument;
  const onOutside = (event: Event): void => {
    if (menu.hidden) return;
    if (event.target instanceof Node && root.contains(event.target)) return;
    setOpen(false);
  };
  button.addEventListener("click", onButton);
  root.addEventListener("keydown", onKey);
  doc.addEventListener("pointerdown", onOutside, true);

  return {
    sync,
    dispose() {
      button.removeEventListener("click", onButton);
      root.removeEventListener("keydown", onKey);
      doc.removeEventListener("pointerdown", onOutside, true);
      root.remove();
    },
  };
}
