/**
 * The 3D view's bottom panel: one collapsible, resizable panel at the
 * view's foot with four tabs - Problems, History, Map loading and
 * Performance - opened by the bottom bar's named toggles, each with a
 * badge only while there is something to see. The panel's rules are
 * `bottom-panel-model.ts`; this draws them and takes the clicks, the
 * grip's drag and the keys (Ctrl+J, Ctrl+Shift+M, Escape inside it).
 *
 * It sits between the docks (or spans under them), and tells the page its
 * height in `--s-panel-h` on the page's body: the 3D view's canvas ends at
 * its top (the panel pushes the view up, the docks keep their height), and
 * the map controls, the toasts and, on a narrow window, the docks keep
 * clear of it. Its height and last tab are kept in the browser
 * (`localStorage`, when it allows). A redraw keeps the keyboard focus on
 * the control that had it (found again by its data attribute).
 *
 * @see bottom-panel.ts.md
 */
import type {
  OsmMapTile,
  OsmRetryAsk,
  OsmRetryOutcome,
} from "gps-plus-slam-globe/editor";

import type { Editor3dReadout } from "../../editor3d/editor3d-scene.js";
import {
  PANEL_HEIGHT,
  PANEL_TABS,
  clampHeight,
  countdown,
  dragged,
  historyBadge,
  historyRows,
  minutesAgo,
  perfBadge,
  problemsBadge,
  readSaved,
  startHeight,
  tilesBadge,
  toggled,
  withNewFrames,
  type HistoryRow,
  type PanelBadge,
  type PanelState,
  type PanelTab,
} from "./bottom-panel-model.js";
import {
  problemCounts,
  type ProblemFix,
  type ProblemGroup,
  type ProblemSeverity,
} from "./tour-problems.js";

/** Where the browser keeps the panel's height and last tab. */
export const PANEL_STORAGE_KEY = "editor-bottom-panel";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The panel's icons (16 px, stroked as the shell's). */
const ICON = {
  problems: '<path d="M8 2.2 14.2 13H1.8z"/><path d="M8 6.4v3.2M8 11.4v.1"/>',
  history: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.6V8l2.3 1.5"/>',
  tiles:
    '<path d="M1.8 4.2 5.8 2.6l4.4 1.6 4-1.6v9.2l-4 1.6-4.4-1.6-4 1.6z"/><path d="M5.8 2.6v9.2M10.2 4.2v9.2"/>',
  perf: '<path d="M1.5 8.6h2.8l1.6-4.2 2.5 8 1.8-5.4 1.1 1.6h3.2"/>',
  chev: '<path d="M6 3.8 10.2 8 6 12.2"/>',
  error:
    '<circle cx="8" cy="8" r="6"/><path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4"/>',
  warning: '<path d="M8 2.2 14.2 13H1.8z"/><path d="M8 6.4v3.2M8 11.4v.1"/>',
  note: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.9v.1"/>',
  ok: '<circle cx="8" cy="8" r="6"/><path d="m5.3 8.2 1.9 1.9 3.6-3.8"/>',
  up: '<path d="M4 10l4-4 4 4"/>',
  down: '<path d="M4 6l4 4 4-4"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  slow: '<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2 1.2"/>',
  retry: '<path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8"/><path d="M13.2 2.6v3h-3"/>',
} as const;

type PanelIcon = keyof typeof ICON;

function icon(name: PanelIcon, extra = ""): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `i ${extra}`.trim());
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICON[name];
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A chip of the panel's head (a filter, Undo, Redo). */
function chip(label: string, title: string): HTMLButtonElement {
  const button = el("button", "chip");
  button.type = "button";
  button.title = title;
  button.append(el("span", "cl", label));
  return button;
}

const SEVERITY_LABEL: Readonly<Record<ProblemSeverity, string>> = {
  error: "Errors",
  warning: "Warnings",
  note: "Notes",
};

/** The toggles' shortcut, where one has it. */
const TAB_KEY: Partial<Record<PanelTab, string>> = {
  problems: "Ctrl+Shift+M",
};

/** The history as the History tab reads it. */
interface PanelHistory {
  readonly past: readonly { readonly what: string }[];
  readonly future: readonly { readonly what: string }[];
  readonly position: number;
  readonly savedAt: number | "elsewhere" | null;
}

/** The street map's tiles and its retry, as the Map loading tab reads
 *  them from the shown view (nothing without one). */
interface PanelMap {
  /** The near tiles, failed first (the overlay's `mapTiles`). */
  tiles(limit: number): readonly OsmMapTile[];
  /** Ask for the failed tiles again now: how many it asks for, or why
   *  none, and the retry that will answer it. */
  retry(): OsmRetryAsk;
  /** What became of the last retry's tiles (null before it ran). */
  lastRetry(): OsmRetryOutcome | null;
}

/** The data attributes a focused control is found again by after a
 *  redraw, in the order they are looked for. */
const FOCUS_KEYS = [
  "fix",
  "select",
  "fold",
  "row",
  "filter",
  "step",
  "retry",
] as const;

/** The tiles the table lists at most, and the ones it reads to count. */
const TILE_ROWS = 40;
const TILE_COUNT = 400;

/** How long a retry is watched before it is said to be still loading
 *  (ms). */
const RETRY_WATCH_MS = 30_000;

const TILE_STATUS: Readonly<Record<OsmMapTile["status"], string>> = {
  failed: "Failed",
  loading: "Loading",
  waiting: "Waiting",
  loaded: "Loaded",
};

const plural = (n: number, one: string) =>
  `${String(n)} ${n === 1 ? one : `${one}s`}`;

export interface BottomPanelDeps {
  /** The panel (`#shell-panel`) and the bar's toggles
   *  (`#shell-toggles`). */
  readonly panel: HTMLElement;
  readonly toggles: HTMLElement;
  /** The view's box (`#view3d`): its height bounds the panel's. The
   *  panel's height goes in `--s-panel-h` on the page's body. */
  readonly box: HTMLElement;
  /** A problem's row clicked: select its object (and fly to it). */
  readonly choose: (selection: string) => void;
  /** A problem's fix link clicked: its object selected, the fix written
   *  (one undo step) and said. */
  readonly fix: (selection: string, fix: ProblemFix) => void;
  /** The street map's tiles and retry (the Map loading tab). */
  readonly map: PanelMap;
  /** When a step of the edit history was made (ms, `now`'s clock), or
   *  undefined when it is not known. */
  readonly stepTime: (step: object) => number | undefined;
  /** The clock (ms): `Date.now` by default. */
  readonly now?: () => number;
  /** One step of the edit history (a History row takes several). */
  readonly step: (which: "undo" | "redo") => void;
  /** Where the panel's height and tab are kept; null where the browser
   *  keeps nothing. */
  readonly storage: Pick<Storage, "getItem" | "setItem"> | null;
}

/** The docked layout's side of a docked panel (`dock-host.ts`): each
 *  tab's pane is a panel of its own there. */
interface PanelDock {
  /** Shows the tab's panel (its group shown, it the shown tab). */
  show(tab: PanelTab): void;
  /** Hides the panes' group. */
  hide(): void;
}

export interface BottomPanel {
  /** The tour's problems changed (and the selection, marked in them). */
  problems(groups: readonly ProblemGroup[], selected: string | null): void;
  /** The edit history changed. */
  history(history: PanelHistory): void;
  /** The view's readout tick: the Map loading and Performance tabs. */
  tick(readout: Editor3dReadout): void;
  /** A key while the view shows: true when the panel took it. */
  key(event: KeyboardEvent): boolean;
  /** Where things stand, for the page's checks. */
  state(): PanelState & { readonly heightPx: number };
  /** The view hides: the panel closes, its toggles go with the bar. */
  hide(): void;
  /** Docked: the panes are docked panels, shown and hidden through
   *  `dock`, and the panel itself stays hidden; null: the panel again. */
  dock(dock: PanelDock | null): void;
  /** Docked: the docking's own controls showed a tab or hid the group. */
  docked(state: { readonly open: boolean; readonly tab: PanelTab }): void;
}

/** The panel; its markup is the page's (`edit.html`), its contents its
 *  own. */
export function createBottomPanel(deps: BottomPanelDeps): BottomPanel {
  const { panel, toggles, box } = deps;
  const clock = deps.now ?? Date.now;
  const saved = (() => {
    try {
      return readSaved(deps.storage?.getItem(PANEL_STORAGE_KEY) ?? null);
    } catch {
      return readSaved(null);
    }
  })();
  let ui: PanelState = { open: false, tab: saved.tab, max: false };
  let dock: PanelDock | null = null;
  let heightPx: number | null = saved.heightPx;
  let started = false;
  let groups: readonly ProblemGroup[] = [];
  let selected: string | null = null;
  let history: PanelHistory = {
    past: [],
    future: [],
    position: 0,
    savedAt: null,
  };
  let readout: Editor3dReadout | null = null;
  let frames: number[] = [];
  let seenFrames = 0;
  /** The request ceiling's wait as it began (s): the banner's bar. */
  let waitTotalS = 0;
  /** A retry under way (how many tiles it asked for, since when, the
   *  retry number whose outcome answers it), and what the last one came to
   *  (the tools' status line). */
  let retryRun: {
    readonly asked: number;
    readonly since: number;
    readonly retry: number;
  } | null = null;
  let retryNote = "";
  /** The History rows' time labels and the steps they time. */
  let timeLabels: { readonly node: HTMLElement; readonly at: number }[] = [];
  const folded = new Set<string>();
  const shown: Record<ProblemSeverity, boolean> = {
    error: true,
    warning: true,
    note: true,
  };

  const remember = () => {
    try {
      deps.storage?.setItem(
        PANEL_STORAGE_KEY,
        JSON.stringify({ h: heightPx, tab: ui.tab }),
      );
    } catch {
      // A browser that keeps nothing opens the panel at its defaults.
    }
  };

  // --- the markup ----------------------------------------------------------
  const grip = el("div", "bp-grip");
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-orientation", "horizontal");
  grip.setAttribute("aria-label", "Panel height");
  grip.tabIndex = 0;
  grip.title = "Drag to resize, double-click to maximise";
  const head = el("div", "bp-head");
  const tabs = el("div", "bp-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Panel");
  const tools = el("div", "bp-tools");
  const tabTools = el("div", "tools");
  const headButton = (name: PanelIcon, title: string, cls: string) => {
    const button = el("button", `ib ${cls}`);
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.append(icon(name));
    return button;
  };
  const maxButton = headButton("up", "Maximise the panel", "bp-max");
  const closeButton = headButton(
    "close",
    "Close the panel (Escape)",
    "bp-close",
  );
  tools.append(tabTools, el("span", "sep"), maxButton, closeButton);
  head.append(tabs, tools);
  const body = el("div", "bp-body");
  const panes = new Map<PanelTab, HTMLElement>();
  const tabButtons = new Map<PanelTab, HTMLButtonElement>();
  const toggleButtons = new Map<PanelTab, HTMLButtonElement>();
  const badge = () => el("span", "badge");
  /** Inside the panel, its tools or a pane (docked, they stand apart). */
  const inside = (node: Node | null): boolean =>
    node !== null &&
    (panel.contains(node) ||
      tabTools.contains(node) ||
      [...panes.values()].some((pane) => pane.contains(node)));
  for (const tab of PANEL_TABS) {
    const pane = el("div", "pane");
    pane.id = `shell-pane-${tab.id}`;
    pane.setAttribute("role", "tabpanel");
    // Docked, the keys return to the shown pane when a redraw takes the
    // focused control (its tab is the docking's).
    pane.tabIndex = -1;
    pane.setAttribute("aria-label", tab.label);
    panes.set(tab.id, pane);
    body.append(pane);
    const tabButton = el("button", "tab");
    tabButton.type = "button";
    tabButton.dataset["tab"] = tab.id;
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute("aria-controls", pane.id);
    tabButton.title = tab.label;
    tabButton.append(icon(tab.id), el("span", "tl", tab.label), badge());
    tabButtons.set(tab.id, tabButton);
    tabs.append(tabButton);
    const toggle = el("button", "tog");
    toggle.type = "button";
    toggle.dataset["tab"] = tab.id;
    toggle.setAttribute("aria-controls", panel.id);
    toggle.setAttribute("aria-label", tab.label);
    toggle.append(icon(tab.id), el("span", "tl", tab.label), badge());
    toggleButtons.set(tab.id, toggle);
  }
  toggles.replaceChildren(...toggleButtons.values());
  panel.replaceChildren(grip, head, body);

  // --- drawing -------------------------------------------------------------
  const mainPx = () => box.clientHeight;
  const badgeOf = (tab: PanelTab): PanelBadge | null => {
    if (tab === "problems") return problemsBadge(problemCounts(groups));
    if (tab === "history") {
      return historyBadge({
        position: history.position,
        past: history.past.length,
        future: history.future.length,
      });
    }
    if (tab === "tiles") return tilesBadge(readout?.mapLoad ?? null);
    return perfBadge(readout?.slowFrames ?? 0);
  };

  const drawBadges = () => {
    for (const tab of PANEL_TABS) {
      const found = badgeOf(tab.id);
      for (const button of [
        toggleButtons.get(tab.id),
        tabButtons.get(tab.id),
      ]) {
        const slot = button?.querySelector<HTMLElement>(".badge");
        if (button === undefined || slot === null || slot === undefined) {
          continue;
        }
        const text = found?.text ?? "";
        const cls = `badge ${found?.tone ?? ""}`.trim();
        if (slot.className !== cls) slot.className = cls;
        if (slot.dataset["text"] !== text) {
          slot.dataset["text"] = text;
          slot.replaceChildren();
          if (found?.tone === "busy") slot.append(el("span", "spin"));
          if (text !== "") slot.append(text);
        }
        if (button.classList.contains("tog")) {
          const pressed = ui.open && ui.tab === tab.id;
          button.setAttribute("aria-pressed", String(pressed));
          const key = TAB_KEY[tab.id];
          button.title = `${tab.label}${found === null ? "" : `: ${found.title}`} - click to ${pressed ? "close" : "open"}${key === undefined ? "" : ` (${key})`}`;
        } else {
          button.setAttribute("aria-selected", String(ui.tab === tab.id));
          button.tabIndex = ui.tab === tab.id ? 0 : -1;
        }
      }
    }
  };

  const layout = () => {
    if (dock !== null) {
      // Docked, the panes stand in the layout and push nothing.
      panel.hidden = true;
      document.body.style.setProperty("--s-panel-h", "0px");
      return;
    }
    panel.hidden = !ui.open;
    if (!ui.open) {
      document.body.style.setProperty("--s-panel-h", "0px");
      return;
    }
    const main = mainPx();
    // The first open of a visit starts at what was kept, at most about
    // half the view; later ones keep the height the grip left.
    if (!started && main > 0) {
      heightPx = startHeight(heightPx, main);
      started = true;
    }
    const h = ui.max
      ? main
      : clampHeight(heightPx ?? PANEL_HEIGHT.default, main);
    panel.style.height = `${String(h)}px`;
    document.body.style.setProperty("--s-panel-h", `${String(h)}px`);
    grip.setAttribute("aria-valuemin", String(PANEL_HEIGHT.min));
    grip.setAttribute(
      "aria-valuemax",
      String(Math.max(PANEL_HEIGHT.min, main)),
    );
    grip.setAttribute("aria-valuenow", String(Math.round(h)));
    maxButton.replaceChildren(icon(ui.max ? "down" : "up"));
    const maxTitle = ui.max ? "Restore the panel's size" : "Maximise the panel";
    maxButton.title = maxTitle;
    maxButton.setAttribute("aria-label", maxTitle);
    maxButton.setAttribute("aria-pressed", String(ui.max));
  };

  const drawTools = () => {
    tabTools.replaceChildren();
    if (ui.tab === "problems") {
      const counts = problemCounts(groups);
      for (const severity of ["error", "warning", "note"] as const) {
        const label = SEVERITY_LABEL[severity];
        const button = chip(
          label,
          `${shown[severity] ? "Hide" : "Show"} ${label.toLowerCase()}`,
        );
        button.dataset["filter"] = severity;
        button.setAttribute("aria-pressed", String(shown[severity]));
        button.prepend(icon(severity, `sev-${severity}`));
        button.append(` ${String(counts[severity])}`);
        tabTools.append(button);
      }
    } else if (ui.tab === "history") {
      const undo = chip("Undo", "Undo the last step (Ctrl+Z)");
      undo.dataset["step"] = "undo";
      undo.disabled = history.past.length === 0;
      const redo = chip("Redo", "Redo the next step (Ctrl+Shift+Z)");
      redo.dataset["step"] = "redo";
      redo.disabled = history.future.length === 0;
      tabTools.append(undo, redo);
    } else if (ui.tab === "tiles") {
      const retry = chip(
        retryRun === null ? "Retry failed" : "Retrying...",
        "Retry failed tiles",
      );
      retry.dataset["retry"] = "map";
      retry.disabled = retryRun !== null;
      retry.setAttribute("aria-busy", String(retryRun !== null));
      retry.prepend(icon("retry"));
      const note = el("span", "retry-note", retryNote);
      note.setAttribute("role", "status");
      tabTools.append(retry, note);
    }
  };

  /** The retry's state said: under way, or what it came to. */
  const sayRetry = (text: string) => {
    retryNote = text;
    if (ui.open && ui.tab === "tiles") keepingFocus(drawTools);
  };

  const startRetry = () => {
    let asked: OsmRetryAsk;
    try {
      asked = deps.map.retry();
    } catch (error) {
      retryRun = null;
      sayRetry(
        `Could not retry: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (asked.refused !== null || asked.tiles <= 0) {
      retryRun = null;
      sayRetry(
        asked.refused === "map-off"
          ? "Not retried: the street map is off right now"
          : "Nothing to retry",
      );
      return;
    }
    retryRun = { asked: asked.tiles, since: clock(), retry: asked.retry };
    sayRetry(`Retrying ${plural(asked.tiles, "tile")}...`);
  };

  /** A retry under way, looked at on the readout's tick: its tiles all
   *  loaded or failed again, or still loading after `RETRY_WATCH_MS`. An
   *  outcome of a retry before the ask's own (the overlay keeps the last
   *  one until the next runs) is not this ask's. */
  const watchRetry = () => {
    if (retryRun === null) return;
    const outcome = deps.map.lastRetry();
    if (
      outcome !== null &&
      outcome.retry >= retryRun.retry &&
      outcome.tiles > 0
    ) {
      const pending = outcome.tiles - outcome.loaded - outcome.failed;
      if (pending <= 0) {
        retryRun = null;
        sayRetry(
          outcome.failed === 0
            ? `${plural(outcome.loaded, "tile")} loaded`
            : outcome.loaded === 0
              ? `${plural(outcome.failed, "tile")} failed again`
              : `${String(outcome.loaded)} loaded, ${String(outcome.failed)} failed again`,
        );
        return;
      }
    }
    if (clock() - retryRun.since > RETRY_WATCH_MS) {
      retryRun = null;
      sayRetry("Still loading - the map keeps asking for them");
    }
  };

  const drawProblems = () => {
    const pane = panes.get("problems");
    if (pane === undefined) return;
    const total = groups.reduce((n, g) => n + g.problems.length, 0);
    if (total === 0) {
      const empty = el("div", "empty-state");
      empty.append(icon("ok"), "No problems found in this tour.");
      pane.replaceChildren(empty);
      return;
    }
    const nodes: HTMLElement[] = [];
    for (const group of groups) {
      const list = group.problems.filter((p) => shown[p.severity]);
      if (list.length === 0) continue;
      const wrap = el(
        "div",
        `pgrp${folded.has(group.stationId) ? " fold" : ""}`,
      );
      const groupHead = el("button", "ghead");
      groupHead.type = "button";
      groupHead.dataset["fold"] = group.stationId;
      groupHead.setAttribute(
        "aria-expanded",
        String(!folded.has(group.stationId)),
      );
      groupHead.append(
        icon("chev", "chev"),
        el("span", "num", String(group.number)),
        el("span", "gtitle", group.title),
        el("span", "cnt", String(list.length)),
      );
      wrap.append(groupHead);
      for (const problem of list) {
        // A focusable row (Enter or Space selects) holding its fix link: a
        // button inside a button is not allowed.
        const row = el(
          "div",
          `prow${problem.select === selected ? " sel" : ""}`,
        );
        row.tabIndex = 0;
        row.dataset["select"] = problem.select;
        row.title = `Select ${problem.who}`;
        const what = el("span", "what", `${problem.what} `);
        what.append(el("em", "", `- ${problem.who}`));
        row.append(icon(problem.severity, `sev-${problem.severity}`), what);
        for (const [at, mend] of (problem.fixes ?? []).entries()) {
          const fix = el("button", "lnk fix", mend.label);
          fix.type = "button";
          fix.dataset["fix"] = problem.select;
          fix.dataset["fixAt"] = String(at);
          fix.title = `${mend.label}: ${problem.who}`;
          row.append(fix);
        }
        wrap.append(row);
      }
      nodes.push(wrap);
    }
    if (nodes.length === 0) {
      pane.replaceChildren(
        el(
          "div",
          "empty-state hidden-by-filter",
          `${String(total)} hidden by the filters above.`,
        ),
      );
      return;
    }
    pane.replaceChildren(...nodes);
  };

  const historyRowNode = (row: HistoryRow, index: number) => {
    const node = el(
      "button",
      `hrow ${row.state === "current" ? "cur" : row.state}`,
    );
    node.type = "button";
    node.dataset["row"] = String(index);
    node.dataset["steps"] = String(row.steps);
    node.title =
      row.steps === 0
        ? "This is the current state"
        : row.steps < 0
          ? `Click to go back to this step (undo ${String(-row.steps)})`
          : "Click to redo up to this step";
    node.append(el("span", "dot"), el("span", "lbl", row.what));
    if (row.saved) node.append(el("span", "tagm saved", "saved"));
    if (row.steps === 0) node.append(el("span", "tagm now", "now"));
    const at = row.step === null ? undefined : deps.stepTime(row.step);
    if (at !== undefined) {
      const time = el("span", "tm", minutesAgo(clock() - at));
      node.append(time);
      timeLabels.push({ node: time, at });
    }
    return node;
  };

  /** The History rows' times, kept current on the readout's tick. */
  const drawTimes = () => {
    const t = clock();
    for (const { node, at } of timeLabels) {
      const text = minutesAgo(t - at);
      if (node.textContent !== text) node.textContent = text;
    }
  };

  const drawHistory = () => {
    const pane = panes.get("history");
    if (pane === undefined) return;
    const rows = historyRows(history);
    const list = el("div", "hlist");
    timeLabels = [];
    list.append(...rows.map(historyRowNode));
    const note = el(
      "div",
      "hnote",
      history.future.length > 0
        ? "Greyed steps are undone; click one to redo up to it. A new change drops them."
        : "Newest on top. Click a step to go back to it.",
    );
    pane.replaceChildren(list, note);
  };

  const sumCell = (n: number, label: string, cls = "") => {
    const cell = el("span", `st ${cls}`.trim());
    cell.append(el("b", "", String(n)), el("span", "", label));
    return cell;
  };

  /** The Map loading pane's lasting parts: the rate-limit banner stays
   *  one live element, its words set once, its bar and countdown updated. */
  let tilesBuilt: {
    readonly sum: HTMLElement;
    readonly banner: HTMLElement;
    readonly fill: HTMLElement;
    readonly cd: HTMLElement;
    readonly list: HTMLElement;
  } | null = null;

  const tileTable = (rows: readonly OsmMapTile[]) => {
    const table = el("table", "tiles");
    const headRow = el("tr");
    for (const [label, cls] of [
      ["Status", ""],
      ["Tile", ""],
      ["Layer", ""],
      ["Note", ""],
      ["Time", "ms"],
    ] as const) {
      const th = el("th", cls, label);
      th.scope = "col";
      headRow.append(th);
    }
    table.append(el("thead"), el("tbody"));
    table.tHead?.append(headRow);
    for (const tile of rows.slice(0, TILE_ROWS)) {
      const tr = el("tr");
      const status = el("span", `stt ${tile.status}`);
      status.append(el("i"), TILE_STATUS[tile.status]);
      const statusCell = el("td");
      statusCell.append(status);
      tr.append(
        statusCell,
        el("td", "k", tile.key),
        el("td", "", "Street map"),
        el("td", tile.status === "failed" ? "sev-error" : "", tile.note),
        el("td", "ms", tile.ms === null ? "" : `${String(tile.ms)} ms`),
      );
      table.tBodies[0]?.append(tr);
    }
    return table;
  };

  const drawTiles = () => {
    const pane = panes.get("tiles");
    if (pane === undefined) return;
    const load = readout?.mapLoad ?? null;
    if (load === null) {
      tilesBuilt = null;
      pane.replaceChildren(el("div", "empty-state", "No street map here."));
      return;
    }
    if (tilesBuilt === null) {
      const banner = el("div", "rl");
      banner.setAttribute("role", "status");
      const words = el("span", "t");
      words.append(
        el("b", "", "The map server asked us to slow down."),
        " Waiting tiles load again when the pause ends.",
      );
      const bar = el("span", "bar");
      const fill = el("i");
      bar.append(fill);
      const cd = el("span", "cd");
      banner.append(icon("slow", "sev-warning"), words, bar, cd);
      tilesBuilt = {
        sum: el("div", "sumrow"),
        banner,
        fill,
        cd,
        list: el("div", "tlist"),
      };
      pane.replaceChildren(tilesBuilt.sum, banner, tilesBuilt.list);
    }
    const built = tilesBuilt;
    const rows = deps.map.tiles(TILE_COUNT);
    const count = (status: OsmMapTile["status"]) =>
      rows.filter((r) => r.status === status).length;
    const zooms = rows.map((r) => Number(r.key.split("/")[0]));
    const finest = zooms.length === 0 ? null : Math.max(...zooms);
    built.sum.replaceChildren(
      sumCell(count("loaded"), "loaded"),
      sumCell(count("loading"), "loading"),
      sumCell(count("waiting"), "waiting"),
      sumCell(load.failed, "failed", load.failed > 0 ? "bad" : ""),
      sumCell(load.givenUp, "given up"),
      el(
        "span",
        "st src",
        `Source: street map tiles${finest === null ? "" : `, zoom ${String(finest)}`}`,
      ),
    );
    built.banner.hidden = !(load.ceilingWaitS > 0);
    if (load.ceilingWaitS > 0) {
      waitTotalS = Math.max(waitTotalS, load.ceilingWaitS);
      built.fill.style.width = `${(100 * (1 - load.ceilingWaitS / waitTotalS)).toFixed(1)}%`;
      const text = countdown(load.ceilingWaitS);
      if (built.cd.textContent !== text) built.cd.textContent = text;
    } else {
      waitTotalS = 0;
    }
    const nodes: HTMLElement[] = [];
    if (load.waiting === 0) {
      const done = el("div", "empty-state");
      done.append(icon("ok"), "The street map near the camera has loaded.");
      nodes.push(done);
    }
    if (rows.length > 0) nodes.push(tileTable(rows));
    built.list.replaceChildren(...nodes);
  };

  let perfBuilt: {
    readonly canvas: HTMLCanvasElement;
    readonly now: HTMLElement;
    readonly nums: HTMLElement;
  } | null = null;

  const drawSpark = (canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    // Not laid out (a test's document, a hidden pane): nothing to draw.
    if (rect.width === 0 || rect.height === 0) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const topMs = 66;
    const yOf = (ms: number) =>
      rect.height - 2 - (Math.min(ms, topMs) / topMs) * (rect.height - 6);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#646973";
    for (const [ms, label] of [
      [16.7, "60 fps"],
      [33.3, "30 fps"],
      [50, "50 ms"],
    ] as const) {
      ctx.strokeStyle = ms === 50 ? "rgba(233,184,107,.35)" : "#313338";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, yOf(ms));
      ctx.lineTo(rect.width, yOf(ms));
      ctx.stroke();
      ctx.fillText(label, 4, yOf(ms) - 3);
    }
    ctx.setLineDash([]);
    const n = 240;
    const step = rect.width / (n - 1);
    const xOf = (i: number) => rect.width - (frames.length - 1 - i) * step;
    ctx.beginPath();
    frames.forEach((ms, i) => {
      if (i === 0) ctx.moveTo(xOf(i), yOf(ms));
      else ctx.lineTo(xOf(i), yOf(ms));
    });
    ctx.strokeStyle = "#e9a23b";
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = "#e9b86b";
    frames.forEach((ms, i) => {
      if (ms <= 50) return;
      ctx.beginPath();
      ctx.arc(xOf(i), yOf(ms), 2.5, 0, 7);
      ctx.fill();
    });
  };

  const drawPerf = () => {
    const pane = panes.get("perf");
    if (pane === undefined) return;
    if (perfBuilt === null) {
      const grid = el("div", "perf");
      const chart = el("div", "chart");
      const cap = el("div", "cap");
      const nowSlot = el("b", "", "-");
      const nowWrap = el("span", "", "now ");
      nowWrap.append(nowSlot);
      cap.append(el("span", "", "Frame time, last 4 s"), nowWrap);
      const canvas = el("canvas", "spark");
      canvas.setAttribute("aria-hidden", "true");
      chart.append(cap, canvas);
      const nums = el("div", "nums");
      grid.append(chart, nums);
      pane.replaceChildren(grid);
      perfBuilt = { canvas, now: nowSlot, nums };
    }
    const r = readout;
    perfBuilt.now.textContent =
      frames.length === 0 ? "-" : `${(frames.at(-1) ?? 0).toFixed(1)} ms`;
    const rows: [string, string, string?][] =
      r === null
        ? []
        : [
            ["Average", `${r.frameMs.toFixed(1)} ms`],
            [
              "Worst",
              `${r.worstFrameMs.toFixed(1)} ms`,
              r.worstFrameMs > 50 ? "warn" : "",
            ],
            ["Slow (over 50 ms)", `${String(r.slowFrames)} in 5 s`],
          ];
    const scene: [string, string][] =
      r === null
        ? []
        : [
            ["Draw calls", String(r.drawCalls)],
            ["Triangles", r.triangles.toLocaleString("en")],
          ];
    const view: [string, string][] =
      r === null
        ? []
        : [
            ["View", r.top || r.tiltDeg < 1 ? "Top view" : "3D view"],
            [
              "Tilt / heading",
              `${String(Math.round(r.tiltDeg))} / ${String(Math.round(r.headingDeg))} deg`,
            ],
          ];
    const nodes: HTMLElement[] = [];
    const section = (
      title: string,
      list: readonly (readonly [string, string, string?])[],
    ) => {
      nodes.push(el("h5", "", title));
      for (const [label, value, cls] of list) {
        nodes.push(
          el("span", "k", label),
          el("span", `v ${cls ?? ""}`.trim(), value),
        );
      }
    };
    section("Frames", rows);
    section("Scene", scene);
    section("View", view);
    perfBuilt.nums.replaceChildren(...nodes);
    drawSpark(perfBuilt.canvas);
  };

  const drawPane = () => {
    for (const [tab, pane] of panes) {
      pane.hidden = dock === null && tab !== ui.tab;
    }
    // Docked, the shown tab's tools stand at the top of its panel.
    if (dock !== null) panes.get(ui.tab)?.before(tabTools);
    if (!ui.open) return;
    if (ui.tab === "problems") drawProblems();
    else if (ui.tab === "history") drawHistory();
    else if (ui.tab === "tiles") drawTiles();
    else drawPerf();
  };

  /**
   * Runs `redraw` keeping the keyboard focus inside the open panel: a
   * control the redraw replaced is found again by its data attribute
   * (`FOCUS_KEYS`), else the focus goes to the shown tab, never to the
   * page's body (where Escape and the panel's keys would no longer reach
   * the panel).
   */
  const keepingFocus = (redraw: () => void) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !inside(active)) {
      redraw();
      return;
    }
    const key = FOCUS_KEYS.find((k) => active.dataset[k] !== undefined);
    const value = key === undefined ? undefined : active.dataset[key];
    redraw();
    if (!ui.open || (active.isConnected && document.activeElement === active)) {
      return;
    }
    const match =
      key === undefined || value === undefined
        ? null
        : ([panel, tabTools, ...panes.values()]
            .flatMap((part) => [
              ...part.querySelectorAll<HTMLElement>(`[data-${key}]`),
            ])
            .find((node) => node.dataset[key] === value) ?? null);
    if (
      match !== null &&
      !(match instanceof HTMLButtonElement && match.disabled)
    ) {
      match.focus();
    }
    if (!inside(document.activeElement)) {
      if (dock === null) tabButtons.get(ui.tab)?.focus();
      else panes.get(ui.tab)?.focus();
    }
  };

  const draw = () => {
    keepingFocus(() => {
      layout();
      drawBadges();
      drawTools();
      drawPane();
    });
  };

  const setState = (next: PanelState) => {
    const wasOpen = ui.open;
    const hadFocus = inside(document.activeElement);
    ui = next;
    remember();
    draw();
    if (dock !== null) {
      if (ui.open) dock.show(ui.tab);
      else dock.hide();
    }
    // A close from inside the panel gives the focus to its toggle.
    if (wasOpen && !ui.open && hadFocus) {
      toggleButtons.get(ui.tab)?.focus();
    }
  };

  // --- the clicks ----------------------------------------------------------
  toggles.addEventListener("click", (event) => {
    const tab = (event.target as Element).closest<HTMLElement>("[data-tab]")
      ?.dataset["tab"];
    const known = PANEL_TABS.find((t) => t.id === tab);
    if (known !== undefined) setState(toggled(ui, known.id));
  });
  tabs.addEventListener("click", (event) => {
    const tab = (event.target as Element).closest<HTMLElement>("[data-tab]")
      ?.dataset["tab"];
    const known = PANEL_TABS.find((t) => t.id === tab);
    if (known !== undefined) setState({ ...ui, open: true, tab: known.id });
  });
  tabs.addEventListener("keydown", (event) => {
    // A row of tabs: Left and Right step round, Home and End go to the
    // ends; Up and Down are no tab's (and not the page's either here).
    const at = PANEL_TABS.findIndex((t) => t.id === ui.tab);
    const last = PANEL_TABS.length - 1;
    const to: Partial<Record<string, number>> = {
      ArrowLeft: at === 0 ? last : at - 1,
      ArrowRight: at === last ? 0 : at + 1,
      Home: 0,
      End: last,
    };
    const index = to[event.key];
    if (index === undefined) return;
    event.preventDefault();
    const next = PANEL_TABS[index];
    if (next === undefined) return;
    setState({ ...ui, tab: next.id });
    tabButtons.get(next.id)?.focus();
  });
  closeButton.addEventListener("click", () => {
    setState({ ...ui, open: false, max: false });
  });
  const toggleMax = () => {
    setState({ ...ui, max: !ui.max });
  };
  maxButton.addEventListener("click", toggleMax);
  head.addEventListener("dblclick", (event) => {
    if ((event.target as Element).closest("button") !== null) return;
    toggleMax();
  });
  grip.addEventListener("dblclick", toggleMax);
  tabTools.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    const filter = target?.dataset["filter"] as ProblemSeverity | undefined;
    if (filter !== undefined && filter in shown) {
      shown[filter] = !shown[filter];
      draw();
      return;
    }
    if (target?.dataset["retry"] !== undefined) {
      startRetry();
      return;
    }
    const which = target?.dataset["step"];
    if (which === "undo" || which === "redo") deps.step(which);
  });
  // The rows' clicks and keys are heard on the panes themselves: docked,
  // each pane sits in its docked panel, out of the panel's body.
  const onPaneClick = (event: MouseEvent) => {
    const target = event.target as Element;
    const fold = target.closest<HTMLElement>("[data-fold]")?.dataset["fold"];
    if (fold !== undefined) {
      if (folded.has(fold)) folded.delete(fold);
      else folded.add(fold);
      keepingFocus(drawProblems);
      return;
    }
    const fixLink = target.closest<HTMLElement>("[data-fix]");
    const fixOf = fixLink?.dataset["fix"];
    if (fixOf !== undefined) {
      const at = Number(fixLink?.dataset["fixAt"]);
      const mend = groups
        .flatMap((g) => g.problems)
        .find((p) => p.select === fixOf && p.fixes !== undefined)?.fixes?.[at];
      if (mend !== undefined) deps.fix(fixOf, mend);
      return;
    }
    const select =
      target.closest<HTMLElement>("[data-select]")?.dataset["select"];
    if (select !== undefined) {
      deps.choose(select);
      return;
    }
    const steps = Number(
      target.closest<HTMLElement>("[data-steps]")?.dataset["steps"] ?? "0",
    );
    if (!Number.isInteger(steps) || steps === 0) return;
    const which = steps < 0 ? "undo" : "redo";
    for (let i = 0; i < Math.abs(steps); i += 1) deps.step(which);
  };
  // A problem's row is a focusable row, not a button: Enter or Space on
  // it selects as its click does.
  const onPaneKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target as HTMLElement;
    if (!row.classList.contains("prow")) return;
    const select = row.dataset["select"];
    if (select === undefined) return;
    event.preventDefault();
    deps.choose(select);
  };
  for (const pane of panes.values()) {
    pane.addEventListener("click", onPaneClick);
    pane.addEventListener("keydown", onPaneKey);
  }

  // --- the grip ------------------------------------------------------------
  let drag: { readonly pointer: number } | null = null;
  const heightAt = (clientY: number) =>
    box.getBoundingClientRect().bottom - clientY;
  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { pointer: event.pointerId };
    grip.setPointerCapture?.(event.pointerId);
    grip.classList.add("drag");
  });
  /** The animation frame that writes the dragged height, while one is
   *  asked for, and the pointer's latest place. The view's canvas follows
   *  `--s-panel-h` (each resize reallocates its buffers), so a drag writes
   *  it once a frame, not on each of the frame's pointer moves. */
  let dragFrame: number | null = null;
  let dragY = 0;
  const cancelDragFrame = () => {
    if (dragFrame !== null) cancelAnimationFrame(dragFrame);
    dragFrame = null;
  };
  grip.addEventListener("pointermove", (event) => {
    if (drag === null || drag.pointer !== event.pointerId) return;
    dragY = event.clientY;
    if (dragFrame !== null) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = null;
      if (drag === null) return;
      const h = Math.max(0, heightAt(dragY));
      panel.style.height = `${String(Math.min(h, mainPx()))}px`;
      document.body.style.setProperty("--s-panel-h", panel.style.height);
    });
  });
  const endDrag = (event: PointerEvent) => {
    if (drag === null || drag.pointer !== event.pointerId) return;
    drag = null;
    cancelDragFrame();
    grip.classList.remove("drag");
    const out = dragged(heightAt(event.clientY), mainPx());
    if (out.kind === "close") {
      setState({ ...ui, open: false, max: false });
    } else if (out.kind === "max") {
      setState({ ...ui, max: true });
    } else {
      heightPx = out.heightPx;
      setState({ ...ui, max: false });
    }
  };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", (event) => {
    if (drag === null || drag.pointer !== event.pointerId) return;
    drag = null;
    cancelDragFrame();
    grip.classList.remove("drag");
    draw();
  });
  grip.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const main = mainPx();
    const now = ui.max
      ? main
      : clampHeight(heightPx ?? PANEL_HEIGHT.default, main);
    heightPx = clampHeight(now + (event.key === "ArrowUp" ? 20 : -20), main);
    setState({ ...ui, max: false });
  });

  draw();

  return {
    problems(next, nowSelected) {
      groups = next;
      selected = nowSelected;
      drawBadges();
      if (ui.open && ui.tab === "problems") {
        keepingFocus(() => {
          drawTools();
          drawProblems();
        });
      }
    },
    history(next) {
      history = next;
      drawBadges();
      if (ui.open && ui.tab === "history") {
        keepingFocus(() => {
          drawTools();
          drawHistory();
        });
      }
    },
    tick(next) {
      readout = next;
      frames = withNewFrames(
        frames,
        next.recentFrameMs,
        next.frameCount,
        seenFrames,
      );
      seenFrames = next.frameCount;
      drawBadges();
      watchRetry();
      if (!ui.open) return;
      if (ui.tab === "tiles") keepingFocus(drawTiles);
      else if (ui.tab === "perf") drawPerf();
      else if (ui.tab === "history") drawTimes();
    },
    key(event) {
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && !event.altKey && !event.shiftKey && event.code === "KeyJ") {
        event.preventDefault();
        setState(toggled(ui));
        return true;
      }
      if (ctrl && event.shiftKey && !event.altKey && event.code === "KeyM") {
        event.preventDefault();
        setState(toggled(ui, "problems"));
        return true;
      }
      if (
        event.key === "Escape" &&
        ui.open &&
        inside(event.target as Node | null)
      ) {
        event.preventDefault();
        setState({ ...ui, open: false, max: false });
        return true;
      }
      return false;
    },
    state() {
      return {
        ...ui,
        heightPx: !ui.open
          ? 0
          : dock === null
            ? panel.getBoundingClientRect().height
            : (panes.get(ui.tab)?.parentElement?.getBoundingClientRect()
                .height ?? 0),
      };
    },
    hide() {
      if (ui.open) setState({ ...ui, open: false, max: false });
      frames = [];
      seenFrames = 0;
      readout = null;
    },
    dock(next) {
      if (next === dock) return;
      dock = next;
      if (dock === null) tools.prepend(tabTools);
      draw();
      if (dock !== null && ui.open) dock.show(ui.tab);
      else dock?.hide();
    },
    docked(state) {
      if (dock === null) return;
      if (state.open === ui.open && (!state.open || state.tab === ui.tab)) {
        return;
      }
      ui = state.open
        ? { ...ui, open: true, tab: state.tab }
        : { ...ui, open: false, max: false };
      remember();
      draw();
    },
  };
}
