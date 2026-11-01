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

import type {
  TourBlock,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import "./view-switch.css";
import type { NarrationVerdict } from "./narration-timing.js";
import {
  preferredView,
  shownView,
  viewNeedsFail,
  viewSetOf,
  type ViewPlacement,
} from "./visitor-prefs.js";

/** What each member is called, and its one line (the prototype's copy;
 *  reading's line for a text with a read-along is `READING_NARRATED`). */
const VIEW_COPY: Readonly<Record<string, { label: string; line: string }>> = {
  reading: {
    label: "Reading",
    line: "The whole text in a sheet, read at your own pace",
  },
  lectern: {
    label: "Lectern",
    line: "A reading stand in place, read up close",
  },
  captions: {
    label: "Captions",
    line: "A few lines at a time with the voice, eyes on the place",
  },
};

const READING_NARRATED = "The whole text in a sheet, the voice highlighted";

/** A block's read-along verdict, where the page knows it. */
export type VerdictOf = (block: TourBlock) => NarrationVerdict | undefined;

/** Whether `block` is a text whose voice the sheet highlights (a timing
 *  declared and not found stale). */
function readsAlong(
  block: TourBlock,
  verdict: NarrationVerdict | undefined,
): boolean {
  return (
    block.kind === "longText" &&
    block.narration?.timing !== undefined &&
    verdict !== "stale"
  );
}

function lineOf(view: string, narrated: boolean): string {
  if (view === "reading" && narrated) return READING_NARRATED;
  return VIEW_COPY[view]?.line ?? "";
}

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
  /** That choice, or null. */
  readonly preferred: string | null;
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
 * that kind at that placement, each through `shownView`. `verdictOf`
 * gives a text's read-along verdict, which captions need.
 */
export function viewSwitchModel(
  blocks: readonly TourBlock[],
  stored: unknown,
  verdictOf?: VerdictOf,
): ViewSwitchModel | null {
  for (const block of blocks) {
    const set = viewSetOf(block.kind, block.view);
    if (set === null) continue;
    const verdict = verdictOf?.(block);
    const shown = shownView({
      audience: "visitor",
      block,
      stored,
      ...(verdict === undefined ? {} : { verdict }),
    });
    const narrated = readsAlong(block, verdict);
    const preferred = preferredView(stored, block.kind, set.placement);
    return {
      kind: block.kind,
      placement: set.placement,
      current: labelOf(shown),
      chosen: preferred !== null,
      preferred,
      rows: set.members.map((view) => {
        const fail = viewNeedsFail(block, view, verdict);
        const tags = view === block.view ? [CREATOR_TAG] : [];
        if (fail !== null) tags.push(fail);
        return {
          view,
          label: labelOf(view),
          line: lineOf(view, narrated),
          tag: tags.join(", "),
          disabled: fail !== null,
          on: view === shown,
        };
      }),
    };
  }
  return null;
}

/**
 * The blocks the switch describes: the present station's free blocks,
 * once its content is set (`contentPlaced`), else none - the switch
 * never offers to change a text before the station's content is set
 * (a part may still be loading then).
 */
export function switchBlocks(input: {
  readonly stations: readonly TourStation[] | undefined;
  readonly presentId: string | null;
  readonly contentPlaced: boolean;
}): readonly TourBlock[] {
  if (!input.contentPlaced || input.presentId === null) return [];
  const station = input.stations?.find((s) => s.id === input.presentId);
  return station === undefined ? [] : tourFreeBlocks(station);
}

export interface ViewSwitchDeps {
  /** Where the switch is mounted (the AR overlay root). */
  readonly host: HTMLElement;
  /** The present station's free blocks (empty outside a station) and
   *  the stored preference, and a text's read-along verdict where known. */
  read(): {
    readonly blocks: readonly TourBlock[];
    readonly stored: unknown;
    readonly verdictOf?: VerdictOf;
  };
  /** Stores a choice (null: the creator's again); returns whether the
   *  device keeps it (false: it lasts the visit). */
  choose(kind: string, placement: ViewPlacement, view: string | null): boolean;
  /** Tells the visitor what happened (the walk's toast). */
  say(text: string): void;
  /** The clock for a closing tap's grace, in ms (default
   *  `performance.now`). */
  readonly now?: () => number;
}

export interface ViewSwitch {
  /** Re-reads `read()` and redraws only when the model changed; cheap
   *  enough for every frame. */
  sync(): void;
  /** Closes the menu (the end of an AR session). */
  close(): void;
  dispose(): void;
}

/** How long after the tap that closed the menu lifts its AR select is
 *  still cancelled. XR input reaches the page about once a camera frame
 *  (about 33 ms at 30 fps), so the select may be asked for after
 *  pointerup: 100 ms leaves three frames, which a busy phone can miss;
 *  400 ms comes near a quick deliberate second tap. A mark goes with the
 *  first select it cancels, so the grace eats a later tap only when the
 *  closing tap's own select never came. PROVISIONAL (100, 250 and 400 ms
 *  were weighed, as above); a phone that delivers the closing tap's
 *  select more than 250 ms after pointerup would argue for another
 *  value. */
const CLOSING_TAP_GRACE_MS = 250;

/** How long before an outside pointerdown a select cancelled while the
 *  menu was open is taken for that tap's own (the browser asked for its
 *  select first): the tap then arms no mark, which would otherwise
 *  outlive the select it is for and eat the next tap. The same value as
 *  `CLOSING_TAP_GRACE_MS` but its own question: how far a tap's select
 *  may run ahead of its pointerdown. PROVISIONAL (250 ms, a few camera
 *  frames, swept at 0, 16, 33 and 100 ms in the tests); a visitor whose
 *  tap outside comes within 250 ms of a tap on the open menu has that
 *  tap's select let through, and a device log of a select running further
 *  ahead would argue for a longer value. */
const SELECT_BEFORE_TAP_MS = 250;

/** The pointer an event is from (0 when it carries none). */
function pointerIdOf(event: Event): number {
  const id = (event as { readonly pointerId?: unknown }).pointerId;
  return typeof id === "number" ? id : 0;
}

/** Each switch's menu box gets its own id, for the pill's
 *  `aria-controls`. */
let menusMade = 0;

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
  // A disclosure: the pill shows and hides a box of plain buttons (no
  // menu roles, which promise arrow keys this box does not have).
  button.setAttribute("aria-expanded", "false");
  const current = el("span");
  current.dataset.testid = "view-switch-current";
  button.append(listIcon(), current, el("small", undefined, "change"));
  const menu = el("div", "vs-menu");
  menu.dataset.testid = "view-switch-menu";
  menusMade += 1;
  menu.id = `view-switch-menu-${String(menusMade)}`;
  button.setAttribute("aria-controls", menu.id);
  menu.hidden = true;
  root.append(button, menu);
  deps.host.append(root);

  let model: ViewSwitchModel | null = null;
  let drawnKey = "";
  const now = deps.now ?? (() => performance.now());
  /** The taps that closed the menu from outside, by pointer, to when
   *  their AR select is still cancelled (`onSelect`): while the finger is
   *  down, and `CLOSING_TAP_GRACE_MS` after it lifts. */
  const closingTaps = new Map<number, number>();
  /** When a select was last cancelled because the menu was open: a tap
   *  whose select comes before its pointerdown has had it cancelled so. */
  let openSelectAt = -Infinity;

  function setOpen(open: boolean): void {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  function pick(view: string | null): void {
    if (model === null) return;
    const { kind, placement, preferred } = model;
    setOpen(false);
    // The redraw below takes the focused row out of the page.
    button.focus();
    // The stored choice again changes nothing: nothing is stored, said or
    // drawn again.
    if (view === preferred) return;
    const kept = deps.choose(kind, placement, view);
    sync();
    const label = model?.current ?? labelOf(view ?? "");
    let text: string;
    if (view === null) {
      text = kept
        ? `Back to the creator's choice: ${label}.`
        : `Back to the creator's choice for this visit: ${label} (this browser does not keep the choice).`;
    } else if (kept) {
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
      item.setAttribute("aria-pressed", String(row.on));
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
    const { blocks, stored, verdictOf } = deps.read();
    model = viewSwitchModel(blocks, stored, verdictOf);
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
    // The tap's select came first and is already cancelled: a mark armed
    // now would outlive it and eat the next tap.
    if (now() - openSelectAt <= SELECT_BEFORE_TAP_MS) {
      openSelectAt = -Infinity;
      return;
    }
    closingTaps.set(pointerIdOf(event), Infinity);
  };
  const onTapEnd = (event: Event): void => {
    const id = pointerIdOf(event);
    if (closingTaps.has(id)) closingTaps.set(id, now() + CLOSING_TAP_GRACE_MS);
  };
  // In AR a tap on the DOM overlay asks `beforexrselect` before it becomes
  // the world's select. While the menu is open no tap may reach the world,
  // nor may the tap that closed it: its select is cancelled while it is
  // down and for a short grace after it lifts, once. A select carries no
  // pointer, so it takes the oldest mark still in force.
  const onSelect = (event: Event): void => {
    if (!menu.hidden) {
      openSelectAt = now();
      event.preventDefault();
      return;
    }
    const t = now();
    for (const [id, until] of closingTaps) {
      closingTaps.delete(id);
      if (until >= t) {
        event.preventDefault();
        return;
      }
    }
  };
  button.addEventListener("click", onButton);
  root.addEventListener("keydown", onKey);
  doc.addEventListener("pointerdown", onOutside, true);
  doc.addEventListener("pointerup", onTapEnd, true);
  doc.addEventListener("pointercancel", onTapEnd, true);
  doc.addEventListener("beforexrselect", onSelect, true);

  return {
    sync,
    close() {
      setOpen(false);
      closingTaps.clear();
      openSelectAt = -Infinity;
    },
    dispose() {
      button.removeEventListener("click", onButton);
      root.removeEventListener("keydown", onKey);
      doc.removeEventListener("pointerdown", onOutside, true);
      doc.removeEventListener("pointerup", onTapEnd, true);
      doc.removeEventListener("pointercancel", onTapEnd, true);
      doc.removeEventListener("beforexrselect", onSelect, true);
      root.remove();
    },
  };
}
