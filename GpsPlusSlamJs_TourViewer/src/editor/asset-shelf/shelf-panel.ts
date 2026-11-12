/**
 * The asset shelf's panel: a dock at the right edge beside the inspector
 * that folds to a rail of progress rings, a sheet of its own on a phone
 * with a progress pill over the map while it is closed, and the bottom
 * bar's "Assets" toggle with its badge. Per file a card: its kind, its
 * state and sizes, Retry, "Use the original", where it is used and a
 * delete (an unused file goes with an Undo; a used one says where first
 * and what the delete does, the page deleting it), and "Replace in N
 * places..." for a used file (the page picks and switches the file).
 * Over the list a summary of what a phone downloads, with "Optimize this
 * tour" for the opened tour's files. It reads the shelf's rows
 * (`selectShelfRows`) and acts through the shelf (`asset-shelf.ts`);
 * the words are `shelf-panel-model.ts`'s. Text only, never markup.
 *
 * @see shelf-panel.ts.md
 */
import { shellIcon, type ShellIcon } from "gps-plus-slam-editor-kit/chrome";

import { el } from "../editor-shell/inspector-fields.js";
import type { AssetPlace } from "./asset-places.js";
import type { ShelfRow } from "./asset-shelf-slice.js";
import type { UseInChoice, UseInGroup } from "./use-in-choices.js";
import {
  cardKindLine,
  cardMore,
  cardWarning,
  formatBytes,
  cardState,
  filteredRows,
  pillView,
  placesWord,
  railView,
  shapeKey,
  SHELF_KINDS,
  shelfBadge,
  shelfChips,
  shelfSummary,
  stateLine,
  usesLabel,
  type ShelfFilter,
} from "./shelf-panel-model.js";

/** Where the folded state is kept between visits. */
export const SHELF_FOLD_KEY = "tour-editor-shelf-folded";

/** A ring's circumference (radius 11 in a 28 px box). */
const RING_C = 2 * Math.PI * 11;

/** The shelf's own icons, where the shell has none. */
const OWN_ICONS = {
  upload: '<path d="M8 11V3M5 6l3-3 3 3M3 12.5h10"/>',
  retry:
    '<path d="M12.6 8.4a4.6 4.6 0 1 1-1.4-3.6"/><path d="M12.4 2.6v2.6H9.8"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
  alert: '<path d="M8 2.5l6 11H2z"/><path d="M8 6.5v3.5M8 12v.1"/>',
  jump: '<path d="M4.5 11.5l7-7M6 4.5h5.5V10"/>',
  shelf:
    '<path d="M2 5.5l6-3 6 3-6 3z"/><path d="M2 5.5v5l6 3 6-3v-5M8 8.5v5"/>',
  back: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  left: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  play: '<path d="M5.5 3.5l7 4.5-7 4.5z"/>',
} as const;

type OwnIcon = keyof typeof OWN_ICONS;

/** The icon of each kind of "Use in..." choice. */
const USE_IN_ICONS: Readonly<Record<UseInChoice["icon"], ShellIcon | OwnIcon>> =
  { station: "station", story: "story", swap: "pencil" };

const SVG_NS = "http://www.w3.org/2000/svg";

function ownIcon(name: OwnIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "i");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  // The paths are this file's constants, never a file's text.
  svg.innerHTML = OWN_ICONS[name];
  return svg;
}

function icon(name: ShellIcon | OwnIcon): SVGSVGElement {
  return name in OWN_ICONS
    ? ownIcon(name as OwnIcon)
    : shellIcon(name as ShellIcon);
}

/** The shell's icon for a file's kind. */
const KIND_ICON = {
  picture: "photo",
  sound: "audio",
  video: "video",
  model: "model",
} as const satisfies Record<string, ShellIcon>;

interface ShelfToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface ShelfPanelDeps {
  /** The dock (`aside#shell-shelf`), filled here. */
  readonly root: HTMLElement;
  /** The bottom bar's "Assets" toggle. */
  readonly toggle: HTMLButtonElement;
  /** The phone's pill over the map. */
  readonly pill: HTMLButtonElement;
  /** Where the popover goes (the page's body). */
  readonly host: HTMLElement;
  readonly rows: () => readonly ShelfRow[];
  /** Calls the listener after each change of the page's state; returns
   *  the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly retry: (id: string) => boolean;
  readonly useOriginal: (id: string) => Promise<boolean>;
  readonly remove: (id: string) => (() => void) | null;
  /** A file in use deleted with every use of it: `plan` says in plain
   *  words what the delete does ("Deletes 2 items, removes it from 1
   *  other.") or why it cannot be done; `run` deletes it, the page saying
   *  so with its own Undo. Without it a file in use is not deleted: the
   *  confirm says where it is used. */
  readonly removeUsed?: {
    readonly plan: (
      id: string,
    ) =>
      | { readonly kind: "plan"; readonly words: string }
      | { readonly kind: "refused"; readonly reason: string };
    readonly run: (id: string) => void;
  };
  /** "Replace everywhere": how many items and places a file's replace
   *  switches (`count`; 0, no offer) and the replace itself (`run`: the
   *  page picks the new file, switches every use in one step and says the
   *  outcome; settled once all that is done). Absent, no offer. */
  readonly replace?: {
    readonly count: (id: string) => number;
    readonly run: (id: string) => Promise<void>;
  };
  readonly optimizeTour: () => number;
  /** Opens the picker for files to add. */
  readonly addFiles: () => void;
  readonly placesOf: (id: string) => readonly AssetPlace[];
  /** Selects and shows a place (`AssetPlace.selection`). */
  readonly show: (selection: string) => void;
  /** "Use in...": where the file may be used (`use-in-choices.ts`) and
   *  its use there by a choice's key; absent, the card offers no "Use
   *  in...". */
  readonly useIn?: {
    readonly choices: (id: string) => readonly UseInGroup[];
    readonly use: (id: string, key: string) => void;
  };
  /** The picture a card shows: a picture's bytes, a video's poster's;
   *  absent or undefined, the kind's icon. */
  readonly thumbOf?: (row: ShelfRow) => Blob | undefined;
  /** Object URLs for the thumbnails (default: the browser's). */
  readonly objectUrl?: {
    readonly create: (blob: Blob) => string;
    readonly revoke: (url: string) => void;
  };
  readonly toast: (text: string, action?: ShelfToastAction) => void;
  /** Keeps the fold; null where nothing can be kept. */
  readonly storage: Pick<Storage, "getItem" | "setItem"> | null;
  /** A phone's layout: the shelf is a sheet, never folded. */
  readonly phone: () => boolean;
  /** True while the open shelf has no room beside the open details
   *  (`shelfSqueezed`): it shows as its rail, without changing the kept
   *  fold. Absent: never. */
  readonly squeezed?: () => boolean;
  /** Asked when the shelf is opened while squeezed: makes the room (the
   *  page folds the details). */
  readonly makeRoom?: () => void;
  /** True while the editor's panels are docked: the shelf is the Files
   *  panel there, never a rail. Absent: never. */
  readonly docked?: () => boolean;
  /** Docked, shows the Files panel (opening the shelf asks for it). */
  readonly revealDocked?: () => void;
  /** Docked, whether the Files panel shows (the toggle is pressed then).
   *  Absent: never. */
  readonly filesShown?: () => boolean;
}

export interface ShelfPanel {
  /** Draws the panel from the rows now. */
  refresh(): void;
  /** Brings the file's card into sight, opened. */
  reveal(id: string): void;
  /** Opens the shelf (unfolds it, or opens its sheet on a phone). */
  open(): void;
  /** Stops listening and closes the popover. */
  destroy(): void;
}

interface PanelState {
  folded: boolean;
  sheet: boolean;
  filter: ShelfFilter;
  openCard: string | null;
  confirm: string | null;
  /** Files whose "Use the original" is under way. */
  readonly goingBack: Set<string>;
  /** Files whose "Replace everywhere" is under way. */
  readonly replacing: Set<string>;
}

/** "Replace in 5 places...": the replace's offer with its count (items,
 *  station cards, the tour's cover). */
function replaceLabel(n: number): string {
  return `Replace in ${String(n)} place${n === 1 ? "" : "s"}...`;
}

function readFolded(storage: ShelfPanelDeps["storage"]): boolean {
  try {
    return storage?.getItem(SHELF_FOLD_KEY) === "1";
  } catch {
    return false;
  }
}

function button(
  className: string,
  act: string,
  text: string,
  iconName?: ShellIcon | OwnIcon,
): HTMLButtonElement {
  const b = el("button", className);
  b.type = "button";
  b.dataset["act"] = act;
  if (iconName !== undefined) b.append(icon(iconName));
  b.append(text);
  return b;
}

function iconOnly(
  act: string,
  label: string,
  iconName: ShellIcon | OwnIcon,
  className = "ib",
): HTMLButtonElement {
  const b = el("button", className);
  b.type = "button";
  b.dataset["act"] = act;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.append(icon(iconName));
  return b;
}

/** A progress bar of `percent`, named `label`. */
function bar(percent: number, label: string): HTMLElement {
  const b = el("span", "as-bar");
  b.setAttribute("role", "progressbar");
  b.setAttribute("aria-label", label);
  b.setAttribute("aria-valuemin", "0");
  b.setAttribute("aria-valuemax", "100");
  b.setAttribute("aria-valuenow", String(percent));
  const fill = el("i", "");
  fill.style.width = `${String(percent)}%`;
  b.append(fill);
  return b;
}

function setBar(b: Element | null, percent: number): void {
  if (b === null) return;
  b.setAttribute("aria-valuenow", String(percent));
  const fill = b.querySelector<HTMLElement>("i");
  if (fill !== null) fill.style.width = `${String(percent)}%`;
}

/** A card's thumbnail: the kind's icon, or the picture at `url` (a
 *  picture's own, a video's poster with a play mark). */
function thumb(row: ShelfRow, url: string | null): HTMLElement {
  const look = SHELF_KINDS[row.kind].icon;
  const t = el("span", `as-thumb k-${look}`);
  t.append(icon(row.character === undefined ? KIND_ICON[look] : "character"));
  if (url !== null) {
    t.classList.add("has-img");
    // An object URL: "blob:" and the origin and a uuid, nothing to quote.
    t.style.backgroundImage = `url("${url}")`;
    if (row.kind === "video") {
      const play = ownIcon("play");
      play.classList.add("play");
      t.append(play);
    }
  }
  return t;
}

/** Puts the popover under `anchor`, its right edge at the anchor's, kept
 *  8 px inside the window; above the anchor where there is no room below. */
function placePop(box: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
  box.style.left = `${String(left)}px`;
  box.style.top = `${String(top)}px`;
}

interface FocusKey {
  readonly aid: string | null;
  readonly act: string | null;
  readonly filter: string | null;
}

/** The focus inside the panel as a key to find it again after a draw. */
function focusKey(root: HTMLElement): FocusKey | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
  const card = active.closest<HTMLElement>("[data-aid]");
  return {
    aid: card?.dataset["aid"] ?? null,
    act: active.dataset["act"] ?? null,
    filter: active.dataset["filter"] ?? null,
  };
}

/** The first element under `scope` whose `data-<name>` is `value`; an
 *  id is a file's, so it is compared, never put into a selector. */
function withData(
  scope: ParentNode,
  name: string,
  value: string,
): HTMLElement | null {
  for (const found of scope.querySelectorAll<HTMLElement>(`[data-${name}]`)) {
    if (found.dataset[name] === value) return found;
  }
  return null;
}

function restoreFocus(root: HTMLElement, key: FocusKey | null): void {
  if (key === null) return;
  const scope = key.aid === null ? root : withData(root, "aid", key.aid);
  if (scope === null) return;
  const target =
    key.filter !== null
      ? withData(scope, "filter", key.filter)
      : key.act !== null
        ? withData(scope, "act", key.act)
        : null;
  (target ?? withData(scope, "act", "toggle"))?.focus();
}

export function createShelfPanel(deps: ShelfPanelDeps): ShelfPanel {
  const { root, toggle, pill, host } = deps;
  const state: PanelState = {
    folded: readFolded(deps.storage),
    sheet: false,
    filter: "all",
    openCard: null,
    confirm: null,
    goingBack: new Set(),
    replacing: new Set(),
  };
  let drawnKey: string | null = null;
  /** The thumbnails' object URLs by file id, with the bytes each was
   *  made from: made once, revoked when the bytes change, the file goes
   *  or the panel does. */
  const thumbs = new Map<
    string,
    { readonly blob: Blob; readonly url: string }
  >();
  const urls = deps.objectUrl ?? {
    create: (blob: Blob) => URL.createObjectURL(blob),
    revoke: (url: string) => {
      URL.revokeObjectURL(url);
    },
  };

  function thumbUrl(row: ShelfRow): string | null {
    const blob = deps.thumbOf?.(row);
    const had = thumbs.get(row.id);
    if (had !== undefined && had.blob === blob) return had.url;
    if (had !== undefined) {
      urls.revoke(had.url);
      thumbs.delete(row.id);
    }
    if (blob === undefined) return null;
    const url = urls.create(blob);
    thumbs.set(row.id, { blob, url });
    return url;
  }

  function dropGoneThumbs(rows: readonly ShelfRow[]): void {
    for (const [id, { url }] of thumbs) {
      if (rows.some((r) => r.id === id)) continue;
      urls.revoke(url);
      thumbs.delete(id);
    }
  }

  // --- the dock's frame, built once ---------------------------------------
  root.classList.add("as-shelf");
  const head = el("div", "dhead as-head");
  const fold = iconOnly("fold", "Fold the asset shelf", "right");
  fold.setAttribute("aria-expanded", "true");
  const title = el("span", "as-ttl", "Assets");
  const count = el("span", "as-count");
  const add = iconOnly(
    "add",
    "Add files from this computer",
    "upload",
    "ib as-acc",
  );
  const close = iconOnly("close", "Close the assets", "close", "ib as-close");
  head.append(fold, title, count, el("span", "sp"), add, close);
  const summary = el("div", "as-sum");
  summary.setAttribute("role", "status");
  summary.setAttribute("aria-live", "polite");
  const chips = el("div", "as-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Show");
  const body = el("div", "dbody as-body");
  const list = el("div", "as-list");
  list.setAttribute("role", "list");
  body.append(list);
  const foot = el(
    "div",
    "as-foot",
    "Drop files anywhere on the page, or on a station, a story or an item to use them there.",
  );
  const rail = el("div", "as-rail");
  rail.setAttribute("aria-label", "Assets, folded");
  root.replaceChildren(head, summary, chips, body, foot, rail);

  // --- the popover ---------------------------------------------------------
  let pop: { box: HTMLElement; anchor: HTMLElement; off: () => void } | null =
    null;

  function closePop(focusBack: boolean): void {
    if (pop === null) return;
    const { box, anchor, off } = pop;
    pop = null;
    off();
    box.remove();
    if (focusBack && anchor.isConnected) anchor.focus();
  }

  function openUses(row: ShelfRow, anchor: HTMLElement): void {
    openPop(anchor, `${row.name} is used in`, (box) => {
      box.append(el("div", "mhead", `${row.name} is used in`));
      for (const place of deps.placesOf(row.id)) {
        const { selection } = place;
        // A place nothing selects (a character) is named, not offered.
        if (selection === undefined) {
          box.append(el("div", "mhead", place.label));
          continue;
        }
        const item = button("mi", "go", "", "jump");
        item.setAttribute("role", "menuitem");
        item.append(el("span", "mt", place.label));
        item.addEventListener("click", () => {
          closePop(false);
          deps.show(selection);
        });
        box.append(item);
      }
      if (deps.useIn !== undefined) {
        box.append(el("div", "msep"));
        const item = button("mi", "usein", "", "plus");
        item.setAttribute("role", "menuitem");
        item.append(el("span", "mt", "Use it somewhere else..."));
        item.addEventListener("click", () => {
          openUseIn(row, anchor);
        });
        box.append(item);
      }
    });
  }

  /** "Use in...": the places the file may go, by group (`useIn.choices`);
   *  a choice uses it there (`useIn.use`). */
  function openUseIn(row: ShelfRow, anchor: HTMLElement): void {
    const useIn = deps.useIn;
    if (useIn === undefined) return;
    openPop(anchor, `Use ${row.name} in`, (box) => {
      // A phone puts files to work here, so the replace is offered here
      // too.
      const replacing = deps.phone() ? replaceCountOf(row) : 0;
      if (replacing > 0) {
        const item = button("mi", "replace", "", "pencil");
        item.setAttribute("role", "menuitem");
        item.append(el("span", "mt", replaceLabel(replacing)));
        item.addEventListener("click", () => {
          closePop(false);
          void replace(row);
        });
        box.append(item, el("div", "msep"));
      }
      const groups = useIn.choices(row.id);
      if (groups.length === 0) {
        box.append(
          el("div", "mhead", "Nowhere yet: add a station or a story first"),
        );
      }
      for (const group of groups) {
        box.append(el("div", "mhead", group.head));
        for (const choice of group.choices) {
          const item = button("mi", "pick", "", USE_IN_ICONS[choice.icon]);
          item.setAttribute("role", "menuitem");
          item.dataset["key"] = choice.key;
          item.append(el("span", "mt", choice.label));
          item.addEventListener("click", () => {
            closePop(false);
            useIn.use(row.id, choice.key);
          });
          box.append(item);
        }
      }
    });
  }

  /** The popover `label` names, filled by `fill`, under `anchor`. */
  function openPop(
    anchor: HTMLElement,
    label: string,
    fill: (box: HTMLElement) => void,
  ): void {
    closePop(false);
    const box = el("div", "as-pop");
    box.id = "shelf-pop";
    box.setAttribute("role", "menu");
    box.setAttribute("aria-label", label);
    fill(box);
    host.append(box);
    placePop(box, anchor);
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !box.contains(event.target) &&
        !anchor.contains(event.target)
      ) {
        closePop(false);
      }
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePop(true);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [...box.querySelectorAll<HTMLElement>(".mi")];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    box.addEventListener("keydown", keys);
    pop = {
      box,
      anchor,
      off: () => {
        document.removeEventListener("pointerdown", outside, true);
        box.removeEventListener("keydown", keys);
      },
    };
    box.querySelector<HTMLElement>(".mi")?.focus();
  }

  // --- drawing --------------------------------------------------------------
  function drawSummary(rows: readonly ShelfRow[]): void {
    const s = shelfSummary(rows);
    summary.replaceChildren();
    if (s.kind === "empty") {
      summary.append(s.text);
      return;
    }
    if (s.kind === "busy") {
      summary.append(el("b", "", s.lead), ", you can keep working.");
      if (s.failed > 0) {
        summary.append(
          " ",
          el("span", "as-bad", `${String(s.failed)} failed.`),
        );
      }
      summary.append(bar(s.percent, "Optimizing"));
    } else {
      summary.append(el("b", "", s.lead));
      if (s.failed > 0) {
        summary.append(
          ", ",
          el("span", "as-bad", `${String(s.failed)} failed`),
        );
      }
      summary.append(". A phone downloads ", el("span", "as-save", s.after));
      summary.append(
        ` instead of ${s.before}${s.gain === null ? "" : ` (-${String(s.gain)} %)`}.`,
      );
    }
    if (s.optour !== null) {
      const line = el("span", "as-optour");
      line.append(
        el("span", "", s.optour),
        button("btn small", "optour", "Optimize this tour"),
      );
      summary.append(line);
    }
  }

  function drawChips(rows: readonly ShelfRow[]): void {
    const shown = shelfChips(rows, state.filter);
    chips.hidden = shown.length === 0;
    chips.replaceChildren(
      ...shown.map((chip) => {
        const b = el("button", `as-chip${chip.on ? " on" : ""}`, chip.label);
        b.type = "button";
        b.dataset["filter"] = chip.filter;
        b.setAttribute("aria-pressed", String(chip.on));
        b.append(el("span", "as-cn", String(chip.count)));
        return b;
      }),
    );
  }

  function stateEl(row: ShelfRow): HTMLElement {
    const line = stateLine(row);
    const box = el("div", `as-cstate ${line.kind}`);
    switch (line.kind) {
      case "queued":
        box.append(icon("clock"), el("span", "", line.text));
        break;
      case "processing":
        box.append(
          el("span", "as-ph", line.phase),
          el("span", "as-pc", `${String(line.percent)} %`),
          bar(line.percent, `Optimizing ${row.name}`),
        );
        break;
      case "ready":
        box.append(icon("check"), el("span", "as-sz", line.sizes));
        if (line.gain !== null) {
          box.append(el("span", "as-gain", `-${String(line.gain)} %`));
        }
        break;
      case "idle":
        box.append(icon("clock"), el("span", "", line.text));
        break;
      case "kept":
        box.append(
          icon("check"),
          el("span", "", line.text),
          el("span", "as-sz", line.size),
        );
        break;
      case "failed":
        box.append(icon("alert"), el("span", "", line.title));
        if (line.retry)
          box.append(button("btn small", "retry", "Retry", "retry"));
        if (line.why !== "") box.append(el("span", "as-why", line.why));
        break;
    }
    return box;
  }

  function cardEl(row: ShelfRow): HTMLElement {
    const look = cardState(row.status);
    const opened = state.openCard === row.id;
    const card = el("div", `as-card ${look}${opened ? " open" : ""}`);
    card.dataset["aid"] = row.id;
    card.setAttribute("role", "listitem");
    const crow = el("div", "as-crow");
    crow.dataset["act"] = "toggle";
    crow.tabIndex = 0;
    crow.setAttribute("aria-expanded", String(opened));
    crow.setAttribute("aria-label", `${row.name}, ${cardKindLine(row)}`);
    const main = el("div", "as-cmain");
    const top = el("div", "as-ctop");
    top.append(el("span", "as-cname", row.name));
    (top.lastElementChild as HTMLElement).title = row.name;
    if (row.placesInUse > 0) {
      const uses = button("as-uses", "uses", usesLabel(row.placesInUse));
      uses.title = "Where it is used";
      top.append(uses);
    } else {
      top.append(el("span", "as-uses zero", usesLabel(0)));
    }
    main.append(top, el("div", "as-ckind", cardKindLine(row)), stateEl(row));
    const warning = cardWarning(row);
    if (warning !== null) {
      const warn = el("div", "as-warn");
      warn.append(ownIcon("alert"), el("span", "", warning));
      main.append(warn);
    }
    const side = el("div", "as-cside");
    side.append(iconOnly("del", `Delete ${row.name}`, "trash", "ib as-del"));
    crow.append(thumb(row, thumbUrl(row)), main, side);
    card.append(crow);
    if (state.confirm === row.id) {
      card.append(confirmEl(row));
    } else if (opened) {
      card.append(moreEl(row));
    }
    return card;
  }

  function moreEl(row: ShelfRow): HTMLElement {
    const more = el("div", "as-more", cardMore(row));
    // A character's entry: the files he is drawn with.
    if (row.character !== undefined) {
      const files = el("ul", "as-files");
      for (const file of row.character.files) {
        files.append(el("li", "", `${file.name} · ${formatBytes(file.bytes)}`));
      }
      more.append(files);
    }
    const buttons = el("div", "btnrow");
    if (
      deps.useIn !== undefined &&
      row.status !== "failed" &&
      row.character === undefined
    ) {
      buttons.append(button("btn small", "usein", "Use in...", "plus"));
    }
    if (row.status === "optimized" && row.canUseOriginal) {
      const going = state.goingBack.has(row.id);
      const b = button(
        "btn small",
        "useorig",
        going ? "Going back..." : "Use the original",
        "back",
      );
      b.disabled = going;
      if (going) b.setAttribute("aria-busy", "true");
      buttons.append(b);
    }
    if (row.placesInUse > 0) {
      buttons.append(button("btn small", "uses", "Show where", "jump"));
    }
    const replacing = replaceCountOf(row);
    if (replacing > 0) {
      const busy = state.replacing.has(row.id);
      const b = button(
        "btn small",
        "replace",
        busy ? "Replacing..." : replaceLabel(replacing),
        "pencil",
      );
      b.disabled = busy;
      if (busy) b.setAttribute("aria-busy", "true");
      buttons.append(b);
    }
    if (buttons.childElementCount > 0) more.append(buttons);
    return more;
  }

  function confirmEl(row: ShelfRow): HTMLElement {
    const box = el("div", "as-confirm");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-label", `Delete ${row.name}`);
    const places = deps.placesOf(row.id);
    const plan = deps.removeUsed?.plan(row.id);
    const words = el("div", "");
    words.append(
      el(
        "b",
        "",
        // Only a character's entry asks with no place using it.
        places.length === 0
          ? `Delete ${row.name}?`
          : `${row.name} is used in ${placesWord(places.length)}.`,
      ),
      plan === undefined
        ? " Take it out of them first; then it can be deleted."
        : ` ${plan.kind === "plan" ? plan.words : plan.reason}`,
    );
    const where = el("ul", "");
    for (const place of places) {
      const li = el("li", "");
      const { selection } = place;
      if (selection === undefined) {
        li.textContent = place.label;
      } else {
        const go = el("button", "as-link", place.label);
        go.type = "button";
        go.addEventListener("click", () => {
          deps.show(selection);
        });
        li.append(go);
      }
      where.append(li);
    }
    const buttons = el("div", "btnrow");
    buttons.append(button("btn small", "delno", "Keep it"));
    if (plan?.kind === "plan") {
      buttons.append(button("btn small danger", "delyes", "Delete", "trash"));
    }
    box.append(words, where, buttons);
    return box;
  }

  function emptyEl(): HTMLElement {
    const box = el("div", "as-empty");
    box.append(
      icon("upload"),
      el(
        "div",
        "",
        "Drop sounds, pictures, videos or 3D models anywhere on the page.",
      ),
    );
    const buttons = el("div", "btnrow");
    buttons.append(button("btn small", "add", "Add files...", "upload"));
    box.append(buttons);
    return box;
  }

  function ringEl(
    ring: ReturnType<typeof railView>["rings"][number],
  ): HTMLElement {
    const b = el("button", `as-ring ${ring.state}`);
    b.type = "button";
    b.dataset["rid"] = ring.id;
    b.title = ring.tip;
    b.setAttribute("aria-label", ring.tip);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "rg");
    svg.setAttribute("viewBox", "0 0 28 28");
    svg.setAttribute("aria-hidden", "true");
    const circle = (cls: string) => {
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("class", cls);
      c.setAttribute("cx", "14");
      c.setAttribute("cy", "14");
      c.setAttribute("r", "11");
      return c;
    };
    svg.append(circle("bg"));
    if (ring.state !== "failed") {
      const fg = circle("fg");
      fg.setAttribute("stroke-dasharray", String(RING_C));
      fg.setAttribute(
        "stroke-dashoffset",
        String(RING_C * (1 - ring.progress)),
      );
      svg.append(fg);
    }
    b.append(svg, icon(KIND_ICON[SHELF_KINDS[ring.kind].icon]));
    return b;
  }

  function badgeEl(rows: readonly ShelfRow[]): HTMLElement | null {
    const badge = shelfBadge(rows);
    if (badge === null) return null;
    return el(
      "span",
      `as-badge${badge.bad ? " error" : ""}`,
      String(badge.count),
    );
  }

  function drawRail(rows: readonly ShelfRow[]): void {
    const view = railView(rows);
    const headWrap = el("span", "as-rhead");
    headWrap.append(iconOnly("unfold", "Open the asset shelf", "shelf"));
    const badge = badgeEl(rows);
    if (badge !== null) headWrap.append(badge);
    const rings = el("div", "as-rings");
    rings.append(...view.rings.map(ringEl));
    if (view.rest > 0)
      rings.append(el("span", "as-rmore", `+${String(view.rest)}`));
    if (view.allReady) {
      const done = el("span", "as-ring ready");
      done.title = "All ready";
      done.append(icon("check"));
      rings.append(done);
    }
    rail.replaceChildren(
      iconOnly("unfold", "Open the asset shelf", "left"),
      headWrap,
      el("span", "as-rlabel", "Assets"),
      rings,
    );
  }

  /** Shown as its rail: folded by the creator, or squeezed. */
  function railShown(): boolean {
    if (deps.docked?.() === true) return false;
    return state.folded || deps.squeezed?.() === true;
  }

  function drawChrome(rows: readonly ShelfRow[]): void {
    const phone = deps.phone();
    const folded = railShown() && !phone;
    root.classList.toggle("folded", folded);
    document.body.classList.toggle("shelf-folded", folded);
    document.body.classList.toggle("shelf-sheet", phone && state.sheet);
    fold.setAttribute("aria-expanded", String(!folded));
    const pressed = phone
      ? state.sheet
      : deps.docked?.() === true
        ? deps.filesShown?.() === true
        : !folded;
    toggle.setAttribute("aria-pressed", String(pressed));
    toggle.querySelector(".as-badge")?.remove();
    const badge = badgeEl(rows);
    if (badge !== null) toggle.append(badge);
    drawPill(rows, phone);
    count.textContent = rows.length > 0 ? String(rows.length) : "";
  }

  /** The phone's pill: only while the sheet is closed and it has news. */
  function drawPill(rows: readonly ShelfRow[], phone: boolean): void {
    const p = pillView(rows);
    pill.hidden = !phone || state.sheet || p === null;
    pill.classList.toggle("bad", p?.bad ?? false);
    pill.replaceChildren();
    if (p === null) return;
    pill.append(
      p.busy ? el("span", "spin") : icon("alert"),
      el("span", "", p.text),
    );
  }

  function full(rows: readonly ShelfRow[]): void {
    const focus = focusKey(root);
    drawSummary(rows);
    drawChips(rows);
    const shown = filteredRows(rows, state.filter);
    list.replaceChildren(
      ...(rows.length === 0 ? [emptyEl()] : shown.map(cardEl)),
    );
    drawRail(rows);
    restoreFocus(root, focus);
  }

  /** Moves the bars, percentages and rings alone. */
  function live(rows: readonly ShelfRow[]): void {
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const card of list.querySelectorAll<HTMLElement>(".as-card")) {
      const row = byId.get(card.dataset["aid"] ?? "");
      if (row === undefined) continue;
      const line = stateLine(row);
      if (line.kind !== "processing") continue;
      const pc = card.querySelector(".as-pc");
      if (pc !== null) pc.textContent = `${String(line.percent)} %`;
      setBar(card.querySelector(".as-bar"), line.percent);
    }
    const s = shelfSummary(rows);
    if (s.kind === "busy") setBar(summary.querySelector(".as-bar"), s.percent);
    for (const ring of railView(rows).rings) {
      const b = withData(rail, "rid", ring.id);
      if (b === null) continue;
      b.title = ring.tip;
      b.setAttribute("aria-label", ring.tip);
      b.querySelector(".fg")?.setAttribute(
        "stroke-dashoffset",
        String(RING_C * (1 - ring.progress)),
      );
    }
  }

  function draw(): void {
    const rows = deps.rows();
    if (state.openCard !== null && !rows.some((r) => r.id === state.openCard)) {
      state.openCard = null;
    }
    if (state.confirm !== null && !rows.some((r) => r.id === state.confirm)) {
      state.confirm = null;
    }
    const key = [
      shapeKey(rows),
      state.filter,
      state.openCard ?? "",
      state.confirm ?? "",
      [...state.goingBack].join(","),
      [...state.replacing].join(","),
    ].join("\u0003");
    if (key === drawnKey) live(rows);
    else full(rows);
    dropGoneThumbs(rows);
    drawnKey = key;
    drawChrome(rows);
  }

  function redraw(): void {
    drawnKey = null;
    draw();
  }

  // --- acting -----------------------------------------------------------------
  function setFolded(folded: boolean): void {
    state.folded = folded;
    try {
      deps.storage?.setItem(SHELF_FOLD_KEY, folded ? "1" : "0");
    } catch {
      // Not kept: the fold lasts this visit.
    }
    redraw();
  }

  function open(): void {
    if (deps.docked?.() === true) {
      deps.revealDocked?.();
      redraw();
      return;
    }
    if (deps.phone()) {
      state.sheet = true;
    } else {
      if (state.folded) setFolded(false);
      if (deps.squeezed?.() === true) deps.makeRoom?.();
    }
    redraw();
  }

  function reveal(id: string): void {
    state.filter = "all";
    state.openCard = id;
    state.confirm = null;
    open();
    const card = withData(list, "aid", id);
    if (card === null) return;
    card.scrollIntoView?.({ block: "nearest" });
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
    card.querySelector<HTMLElement>('[data-act="toggle"]')?.focus();
  }

  /** The card's button acting as `act`. */
  function actOf(id: string, name: string): HTMLElement | null {
    const card = withData(list, "aid", id);
    return card === null ? null : withData(card, "act", name);
  }

  function rowOf(id: string): ShelfRow | undefined {
    return deps.rows().find((r) => r.id === id);
  }

  /** A file in use deleted with its places, after the confirm: the page
   *  deletes it and says so, with its Undo. */
  function removeUsed(row: ShelfRow): void {
    state.confirm = null;
    redraw();
    deps.removeUsed?.run(row.id);
  }

  /** How many places the replace of `row`'s file switches; 0 when it is
   *  not offered. */
  function replaceCountOf(row: ShelfRow): number {
    if (deps.replace === undefined || row.status === "failed") return 0;
    return deps.replace.count(row.id);
  }

  /** "Replace everywhere", the card busy until the page settled it; the
   *  page says the outcome, a failure it did not catch is said here. */
  async function replace(row: ShelfRow): Promise<void> {
    if (deps.replace === undefined || state.replacing.has(row.id)) return;
    state.replacing.add(row.id);
    redraw();
    try {
      await deps.replace.run(row.id);
    } catch {
      deps.toast(`${row.name} could not be replaced.`);
    } finally {
      state.replacing.delete(row.id);
      redraw();
    }
  }

  function remove(row: ShelfRow): void {
    // A character's entry always asks: its delete takes the character out
    // with his files, a step the page makes (`removeUsed`).
    if (row.placesInUse > 0 || row.character !== undefined) {
      state.confirm = row.id;
      redraw();
      actOf(row.id, "delno")?.focus();
      return;
    }
    const undo = deps.remove(row.id);
    if (undo === null) {
      deps.toast(
        `${row.name} could not be deleted: it is no longer on the shelf.`,
      );
      return;
    }
    // The shelf keeps every file the tour names: such a card comes back.
    if (rowOf(row.id) !== undefined) {
      deps.toast(`${row.name} stays on the shelf: the tour still uses it.`);
      return;
    }
    deps.toast(`${row.name} deleted.`, { label: "Undo", run: undo });
  }

  async function useOriginal(row: ShelfRow): Promise<void> {
    if (state.goingBack.has(row.id)) return;
    state.goingBack.add(row.id);
    redraw();
    let done: boolean;
    try {
      done = await deps.useOriginal(row.id);
    } catch {
      done = false;
    } finally {
      state.goingBack.delete(row.id);
      redraw();
    }
    deps.toast(
      done
        ? `The original of ${row.name} is used again.`
        : `The original of ${row.name} could not be used.`,
    );
  }

  /** The panel's own buttons, by their `data-act`. */
  const panelActs: Readonly<Record<string, () => void>> = {
    fold: () => {
      if (!deps.phone()) setFolded(true);
    },
    unfold: open,
    close: () => {
      state.sheet = false;
      redraw();
      toggle.focus();
    },
    add: () => {
      deps.addFiles();
    },
    optour: () => {
      const n = deps.optimizeTour();
      if (n === 0) return;
      deps.toast(
        n === 1
          ? "1 file is being made smaller."
          : `${String(n)} files are being made smaller.`,
      );
    },
  };

  /** A card's buttons, by their `data-act`. */
  const cardActs: Readonly<
    Record<string, (row: ShelfRow, target: HTMLElement) => void>
  > = {
    toggle: (row) => {
      state.openCard = state.openCard === row.id ? null : row.id;
      state.confirm = null;
      redraw();
    },
    uses: openUses,
    usein: openUseIn,
    retry: (row) => {
      deps.retry(row.id);
    },
    useorig: (row) => {
      void useOriginal(row);
    },
    replace: (row) => {
      void replace(row);
    },
    del: remove,
    delyes: removeUsed,
    delno: (row) => {
      state.confirm = null;
      redraw();
      actOf(row.id, "del")?.focus();
    },
  };

  function act(
    name: string,
    target: HTMLElement,
    row: ShelfRow | undefined,
  ): void {
    const own = Object.hasOwn(panelActs, name) ? panelActs[name] : undefined;
    if (own !== undefined) {
      own();
      return;
    }
    const onCard = Object.hasOwn(cardActs, name) ? cardActs[name] : undefined;
    if (row !== undefined) onCard?.(row, target);
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const ring = event.target.closest<HTMLElement>("[data-rid]");
    if (ring !== null) {
      reveal(ring.dataset["rid"] ?? "");
      return;
    }
    const chip = event.target.closest<HTMLElement>("[data-filter]");
    if (chip !== null) {
      state.filter = (chip.dataset["filter"] ?? "all") as ShelfFilter;
      redraw();
      return;
    }
    const target = event.target.closest<HTMLElement>("[data-act]");
    if (target === null || !root.contains(target)) return;
    const name = target.dataset["act"] ?? "";
    const aid = target.closest<HTMLElement>("[data-aid]")?.dataset["aid"];
    act(name, target, aid === undefined ? undefined : rowOf(aid));
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.dataset["act"] !== "toggle"
    ) {
      return;
    }
    event.preventDefault();
    const aid = target.closest<HTMLElement>("[data-aid]")?.dataset["aid"];
    act("toggle", target, aid === undefined ? undefined : rowOf(aid));
  }

  function onToggle(): void {
    if (deps.phone()) {
      state.sheet = !state.sheet;
      redraw();
    } else if (railShown() || deps.docked?.() === true) {
      open();
    } else {
      setFolded(true);
    }
  }

  function onPill(): void {
    state.sheet = true;
    redraw();
  }

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);
  toggle.addEventListener("click", onToggle);
  pill.addEventListener("click", onPill);
  const unsubscribe = deps.subscribe(draw);
  draw();

  return {
    refresh: draw,
    reveal,
    open,
    destroy() {
      unsubscribe();
      for (const { url } of thumbs.values()) urls.revoke(url);
      thumbs.clear();
      closePop(false);
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
      toggle.removeEventListener("click", onToggle);
      pill.removeEventListener("click", onPill);
    },
  };
}
