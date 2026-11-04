/**
 * The bottom panel's rules, without the page: its tabs, the badges on the
 * bottom bar's toggles (only when there is something to see), its height
 * (clamped, started, dragged), what the browser keeps of it, the toggles'
 * open and close, and the History tab's rows.
 *
 * @see bottom-panel-model.ts.md
 */
import type { OsmMapLoad } from "gps-plus-slam-globe/editor";

import type { ProblemSeverity } from "./tour-problems.js";

/** The panel's tabs, in the bar's and the tab strip's order. */
export const PANEL_TABS = [
  { id: "problems", label: "Problems" },
  { id: "history", label: "History" },
  { id: "tiles", label: "Map loading" },
  { id: "perf", label: "Performance" },
] as const;

export type PanelTab = (typeof PANEL_TABS)[number]["id"];

const TAB_IDS: ReadonlySet<string> = new Set(PANEL_TABS.map((t) => t.id));

function isTab(value: unknown): value is PanelTab {
  return typeof value === "string" && TAB_IDS.has(value);
}

/** A toggle's badge: its text, its colour and what its title says. */
export interface PanelBadge {
  readonly text: string;
  readonly tone: "error" | "warning" | "note" | "busy";
  readonly title: string;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${String(n)} ${n === 1 ? one : many}`;

/** The Problems toggle's badge: every problem counted, toned by the
 *  worst; none without a problem. */
export function problemsBadge(
  counts: Readonly<Record<ProblemSeverity, number>>,
): PanelBadge | null {
  const total = counts.error + counts.warning + counts.note;
  if (total === 0) return null;
  const tone =
    counts.error > 0 ? "error" : counts.warning > 0 ? "warning" : "note";
  return {
    text: String(total),
    tone,
    title: `${plural(counts.error, "error")}, ${plural(counts.warning, "warning")}, ${plural(counts.note, "note")}`,
  };
}

/** The History toggle's badge: where the tour stands of its steps, only
 *  while there are steps to redo. */
export function historyBadge(doc: {
  readonly position: number;
  readonly past: number;
  readonly future: number;
}): PanelBadge | null {
  if (doc.future === 0) return null;
  return {
    text: `${String(doc.past)}/${String(doc.past + doc.future)}`,
    tone: "note",
    title: `${plural(doc.future, "step")} to redo`,
  };
}

/** `s` seconds as a countdown, "0:04" (whole seconds, rounded up). */
export function countdown(s: number): string {
  const whole = Math.max(0, Math.ceil(s));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}

/** The Map loading toggle's badge: the request ceiling's wait first, then
 *  the failed tiles, then the ones still loading; none once the map near
 *  the camera has loaded (or there is no map). */
export function tilesBadge(load: OsmMapLoad | null): PanelBadge | null {
  if (load === null) return null;
  if (load.ceilingWaitS > 0) {
    return {
      text: countdown(load.ceilingWaitS),
      tone: "warning",
      title: "The map server asked to wait",
    };
  }
  if (load.failed > 0) {
    return {
      text: String(load.failed),
      tone: "error",
      title: `${plural(load.failed, "tile")} failed`,
    };
  }
  if (load.waiting > 0) {
    return {
      text: String(load.waiting),
      tone: "busy",
      title: `${plural(load.waiting, "tile")} loading`,
    };
  }
  return null;
}

/** The Performance toggle's badge: the slow frames of the last five
 *  seconds, none without one. */
export function perfBadge(slowFrames: number): PanelBadge | null {
  if (!(slowFrames > 0)) return null;
  return {
    text: String(slowFrames),
    tone: "warning",
    title: `${plural(slowFrames, "frame")} over 50 ms in 5 s`,
  };
}

/** The panel's measures (px). */
export const PANEL_HEIGHT = {
  /** Its height on a first open. */
  default: 220,
  /** The least it keeps. */
  min: 90,
  /** What it leaves of the view above it, at most. */
  topMargin: 60,
  /** A drag that ends lower than this closes it. */
  closeBelow: 70,
  /** A drag that ends within this of the view's top maximises it. */
  maxWithin: 30,
  /** The least a start at half the view keeps. */
  startFloor: 120,
} as const;

/** `heightPx` kept between the least height and the view (`mainPx`)
 *  less its top margin. */
export function clampHeight(heightPx: number, mainPx: number): number {
  const most = Math.max(PANEL_HEIGHT.min, mainPx - PANEL_HEIGHT.topMargin);
  if (!Number.isFinite(heightPx)) return PANEL_HEIGHT.min;
  return Math.min(most, Math.max(PANEL_HEIGHT.min, heightPx));
}

/** The height an open starts at: the one kept (or the default), at most
 *  half the view but never under 120 px, clamped. */
export function startHeight(saved: number | null, mainPx: number): number {
  const wanted = saved ?? PANEL_HEIGHT.default;
  const half = Math.max(PANEL_HEIGHT.startFloor, mainPx * 0.5);
  return clampHeight(Math.min(wanted, half), mainPx);
}

/** Where a drag of the grip that ends at `heightPx` leaves the panel. */
export function dragged(
  heightPx: number,
  mainPx: number,
):
  | { readonly kind: "close" }
  | { readonly kind: "max" }
  | { readonly kind: "height"; readonly heightPx: number } {
  if (heightPx < PANEL_HEIGHT.closeBelow) return { kind: "close" };
  if (heightPx > mainPx - PANEL_HEIGHT.maxWithin) return { kind: "max" };
  return { kind: "height", heightPx: clampHeight(heightPx, mainPx) };
}

/** What the browser keeps of the panel (`localStorage`), read
 *  defensively: anything else is the defaults. */
export function readSaved(raw: string | null): {
  readonly heightPx: number | null;
  readonly tab: PanelTab;
} {
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const record =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const h = record["h"];
  const tab = record["tab"];
  return {
    heightPx: typeof h === "number" && Number.isFinite(h) && h > 0 ? h : null,
    tab: isTab(tab) ? tab : "problems",
  };
}

export interface PanelState {
  readonly open: boolean;
  readonly tab: PanelTab;
  /** Maximised: the panel takes the view less its top margin. */
  readonly max: boolean;
}

/** A toggle pressed (`tab`), or Ctrl+J (no tab): a closed panel opens on
 *  it (or its last tab), an open one switches to it, and its own tab (or
 *  Ctrl+J) closes it. A close ends a maximised panel's maximum. */
export function toggled(state: PanelState, tab?: PanelTab): PanelState {
  const target = tab ?? state.tab;
  if (state.open && target === state.tab) {
    return { open: false, tab: target, max: false };
  }
  return { open: true, tab: target, max: state.open ? state.max : false };
}

/** A row of the History tab. */
export interface HistoryRow {
  readonly what: string;
  /** The view the tour stands on, a step before it, or one undone. */
  readonly state: "current" | "done" | "undone";
  /** How many steps a click on it takes: undo when negative, redo when
   *  positive, 0 on the current row. */
  readonly steps: number;
  /** The file written in place holds this view. */
  readonly saved: boolean;
}

/**
 * The History tab's rows, newest first: the undone steps (the next redo
 * nearest the current row), the current view, the steps before it, and
 * the view the history starts from ("Opened the tour", or "Earlier steps"
 * once the history's bound dropped older ones). `future.at(-1)` is the
 * next redo, as `nextStep` reads it.
 */
export function historyRows(doc: {
  readonly past: readonly { readonly what: string }[];
  readonly future: readonly { readonly what: string }[];
  readonly position: number;
  readonly savedAt: number | "elsewhere" | null;
}): HistoryRow[] {
  const rows: HistoryRow[] = [];
  const base = doc.position - doc.past.length;
  const row = (what: string, steps: number): HistoryRow => ({
    what,
    state: steps > 0 ? "undone" : steps === 0 ? "current" : "done",
    steps,
    saved: doc.savedAt === doc.position + steps,
  });
  for (const [j, step] of doc.future.entries()) {
    rows.push(row(step.what, doc.future.length - j));
  }
  for (let i = doc.past.length - 1; i >= 0; i -= 1) {
    rows.push(row(doc.past[i]?.what ?? "", i + 1 - doc.past.length));
  }
  rows.push(
    // 0 - n, not -n: no -0 before any edit.
    row(base === 0 ? "Opened the tour" : "Earlier steps", 0 - doc.past.length),
  );
  return rows;
}

/** The Performance chart's frames: `kept` (oldest first) with the
 *  intervals timed since `seenCount` taken from the view's latest
 *  `recent` ones (`frameCount` timed in all), the last `cap` kept. */
export function withNewFrames(
  kept: readonly number[],
  recent: readonly number[],
  frameCount: number,
  seenCount: number,
  cap = 240,
): number[] {
  const fresh = Math.max(0, Math.min(recent.length, frameCount - seenCount));
  const next = [...kept, ...recent.slice(recent.length - fresh)];
  return next.slice(Math.max(0, next.length - cap));
}
