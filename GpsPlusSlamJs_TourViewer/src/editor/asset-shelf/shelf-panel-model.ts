/**
 * The asset shelf's panel, as data (pure): per file its card (the kind
 * line, the state line, the words of an opened card), the summary over
 * the list, the kind chips, the folded rail's rings and badge, and the
 * phone's progress pill - all from the shelf's rows (`selectShelfRows`).
 * The DOM is `shelf-panel.ts`'s.
 *
 * @see shelf-panel-model.ts.md
 */
import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";

import type { ShelfPhase } from "./asset-jobs.js";
import type { ShelfRow } from "./asset-shelf-slice.js";

const MB = 1024 * 1024;

/** A size as the shelf says it: whole KB under a MB (at least 1), one
 *  decimal under 10 MB, whole MB above. */
export function formatBytes(bytes: number): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe >= MB) return `${(safe / MB).toFixed(safe >= 10 * MB ? 0 : 1)} MB`;
  return `${String(Math.max(1, Math.round(safe / 1024)))} KB`;
}

/** A file's kind as the shelf names it, its chip's plural and its icon. */
export const SHELF_KINDS: Readonly<
  Record<
    TourAssetKind,
    {
      readonly label: string;
      readonly plural: string;
      readonly icon: "picture" | "sound" | "video" | "model";
    }
  >
> = {
  image: { label: "Picture", plural: "Pictures", icon: "picture" },
  audio: { label: "Sound", plural: "Sounds", icon: "sound" },
  video: { label: "Video", plural: "Videos", icon: "video" },
  model: { label: "3D model", plural: "Models", icon: "model" },
};

/** The chips' order, after "All". */
const CHIP_ORDER: readonly TourAssetKind[] = [
  "audio",
  "image",
  "video",
  "model",
];

/** A card's look: the prototype's states, by the job's phase. */
export type CardState =
  "queued" | "processing" | "ready" | "idle" | "kept" | "failed";

export function cardState(status: ShelfPhase): CardState {
  switch (status) {
    case "running":
      return "processing";
    case "optimized":
      return "ready";
    default:
      return status;
  }
}

/** The file's extension, upper case ("FILE" for none). */
export function fileExt(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).trim() : "";
  return ext === "" ? "FILE" : ext.toUpperCase();
}

/** A card's second line: "Sound · WAV · 9.0 MB" (the size it came in). */
export function cardKindLine(row: ShelfRow): string {
  return `${SHELF_KINDS[row.kind].label} · ${fileExt(row.name)} · ${formatBytes(row.originalBytes)}`;
}

/** 0 to 100, whole. */
function percent(fraction: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction || 0)) * 100);
}

/** How much smaller, in whole percent; null when it is not smaller. */
export function gainPercent(before: number, after: number): number | null {
  if (!(before > 0) || !(after >= 0)) return null;
  const gain = Math.round((1 - after / before) * 100);
  return gain > 0 ? gain : null;
}

export type StateLine =
  | { readonly kind: "queued"; readonly text: string }
  | {
      readonly kind: "processing";
      readonly phase: string;
      readonly percent: number;
    }
  | {
      readonly kind: "ready";
      readonly sizes: string;
      readonly gain: number | null;
    }
  | { readonly kind: "idle"; readonly text: string }
  | { readonly kind: "kept"; readonly text: string; readonly size: string }
  | {
      readonly kind: "failed";
      readonly title: string;
      readonly retry: boolean;
      readonly why: string;
    };

/** What a running job does, by kind: the shelf knows no finer phase. */
const PHASE: Readonly<Record<TourAssetKind, string>> = {
  image: "Making the picture smaller",
  audio: "Making the sound smaller",
  video: "Making the video smaller",
  model: "Making the model smaller",
};

/** A card's state line per state. */
const STATE_LINES: Readonly<Record<CardState, (row: ShelfRow) => StateLine>> = {
  queued: (row) => {
    const before = row.queuePosition ?? 0;
    return {
      kind: "queued",
      text: before > 0 ? `Queued, ${String(before)} before it` : "Queued, next",
    };
  },
  processing: (row) => ({
    kind: "processing",
    phase: PHASE[row.kind],
    percent: percent(row.progress),
  }),
  ready: (row) => {
    const after = row.optimizedBytes ?? row.estimatedBytes;
    return {
      kind: "ready",
      sizes: `${formatBytes(row.originalBytes)} → ${formatBytes(after)}`,
      gain: gainPercent(row.originalBytes, after),
    };
  },
  idle: () => ({ kind: "idle", text: "In the tour, not made smaller" }),
  kept: (row) => ({
    kind: "kept",
    text: "The original is used",
    size: formatBytes(row.originalBytes),
  }),
  failed: (row) => ({
    kind: "failed",
    title: row.retryable ? "Not optimized" : "Cannot be used",
    retry: row.retryable,
    why: row.reason ?? "",
  }),
};

/** A card's state line, under its kind line. */
export function stateLine(row: ShelfRow): StateLine {
  return STATE_LINES[cardState(row.status)](row);
}

/** The words of an opened card: what happens to the file. */
export function cardMore(row: ShelfRow): string {
  const original = formatBytes(row.originalBytes);
  switch (cardState(row.status)) {
    case "ready":
      return row.canUseOriginal
        ? "Made smaller for a phone. The original is kept until the next save, so you can still go back to it."
        : "Made smaller for a phone.";
    case "idle":
      return 'Part of the opened tour. "Optimize this tour" makes it smaller for a phone.';
    case "kept":
      return row.reason ?? `The original (${original}) is used.`;
    case "queued":
    case "processing":
      return `Being made smaller for a phone. Until then the original (${original}) is used.`;
    case "failed":
      return row.retryable
        ? `The original (${original}) is used, and a phone downloads all of it.`
        : "";
  }
}

/** The card's count of places: "Used in 2", or "Not used". */
export function usesLabel(placesInUse: number): string {
  return placesInUse > 0 ? `Used in ${String(placesInUse)}` : "Not used";
}

/** "1 place" or "3 places". */
export function placesWord(count: number): string {
  return count === 1 ? "1 place" : `${String(count)} places`;
}

function filesWord(count: number): string {
  return count === 1 ? "1 file" : `${String(count)} files`;
}

const isBusy = (row: ShelfRow) =>
  row.status === "queued" || row.status === "running";

export type ShelfSummary =
  | { readonly kind: "empty"; readonly text: string }
  | {
      readonly kind: "busy";
      /** "Optimizing 2 of 5" */
      readonly lead: string;
      readonly failed: number;
      readonly percent: number;
      readonly optour: string | null;
    }
  | {
      readonly kind: "done";
      /** "3 ready" */
      readonly lead: string;
      readonly failed: number;
      readonly after: string;
      readonly before: string;
      readonly gain: number | null;
      readonly optour: string | null;
    };

/** The line over the list: what is going on, what a phone downloads, and
 *  the opened tour's files still not made smaller. */
export function shelfSummary(rows: readonly ShelfRow[]): ShelfSummary {
  if (rows.length === 0) {
    return { kind: "empty", text: "Nothing on the shelf yet." };
  }
  const idle = rows.filter((r) => r.status === "idle").length;
  const optour =
    idle === 0
      ? null
      : `${filesWord(idle)} of the opened tour ${idle === 1 ? "is" : "are"} not made smaller.`;
  const failed = rows.filter((r) => r.status === "failed").length;
  const busy = rows.filter(isBusy);
  if (busy.length > 0) {
    const sum = busy.reduce((s, r) => s + (r.progress || 0), 0);
    return {
      kind: "busy",
      lead: `Optimizing ${String(busy.length)} of ${String(rows.length)}`,
      failed,
      percent: percent(sum / busy.length),
      optour,
    };
  }
  const before = rows.reduce((s, r) => s + r.originalBytes, 0);
  const after = rows.reduce((s, r) => s + r.estimatedBytes, 0);
  const ready = rows.filter(
    (r) => r.status === "optimized" || r.status === "kept",
  ).length;
  return {
    kind: "done",
    lead: `${String(ready)} ready`,
    failed,
    after: formatBytes(after),
    before: formatBytes(before),
    gain: gainPercent(before, after),
    optour,
  };
}

export type ShelfFilter = "all" | TourAssetKind;

export interface ShelfChip {
  readonly filter: ShelfFilter;
  readonly label: string;
  readonly count: number;
  readonly on: boolean;
}

/** "All" and a chip per kind on the shelf; none under two files (a
 *  filter of one file filters nothing). */
export function shelfChips(
  rows: readonly ShelfRow[],
  filter: ShelfFilter,
): ShelfChip[] {
  if (rows.length < 2) return [];
  const on = shownFilter(rows, filter);
  return [
    { filter: "all", label: "All", count: rows.length, on: on === "all" },
    ...CHIP_ORDER.map((kind) => ({
      filter: kind,
      label: SHELF_KINDS[kind].plural,
      count: rows.filter((r) => r.kind === kind).length,
      on: on === kind,
    })).filter((chip) => chip.count > 0),
  ];
}

/** The filter in effect: one whose kind has left the shelf is "All". */
export function shownFilter(
  rows: readonly ShelfRow[],
  filter: ShelfFilter,
): ShelfFilter {
  if (filter === "all" || rows.length < 2) return "all";
  return rows.some((r) => r.kind === filter) ? filter : "all";
}

/** The rows a filter shows, in the shelf's order. */
export function filteredRows(
  rows: readonly ShelfRow[],
  filter: ShelfFilter,
): readonly ShelfRow[] {
  const shown = shownFilter(rows, filter);
  return shown === "all" ? rows : rows.filter((r) => r.kind === shown);
}

/** At most this many rings on the folded rail; the rest a count. */
export const RAIL_RINGS = 7;

export interface RailRing {
  readonly id: string;
  readonly kind: TourAssetKind;
  readonly state: CardState;
  /** 0 to 1; a failed file's ring is full. */
  readonly progress: number;
  readonly tip: string;
}

export interface RailView {
  readonly rings: readonly RailRing[];
  /** Files in the works beyond the rings shown. */
  readonly rest: number;
  /** Nothing in the works, files on the shelf: a check. */
  readonly allReady: boolean;
}

/** The folded shelf's rail: a ring per file still in the works (queued,
 *  running or failed), the first `RAIL_RINGS`. */
export function railView(rows: readonly ShelfRow[]): RailView {
  const open = rows.filter(
    (r) =>
      r.status === "queued" || r.status === "running" || r.status === "failed",
  );
  const shown = open.slice(0, RAIL_RINGS);
  return {
    rings: shown.map((r) => {
      const state = cardState(r.status);
      const progress =
        state === "failed" ? 1 : Math.min(1, Math.max(0, r.progress || 0));
      const tip =
        state === "failed"
          ? `${r.name}: not optimized`
          : state === "queued"
            ? `${r.name}: queued`
            : `${r.name}: ${String(percent(progress))} %`;
      return { id: r.id, kind: r.kind, state, progress, tip };
    }),
    rest: open.length - shown.length,
    allReady: shown.length === 0 && rows.length > 0,
  };
}

/** The toggle's and the rail's badge: the failed count (marked bad), else
 *  the files in the works; null when there is neither. */
export function shelfBadge(
  rows: readonly ShelfRow[],
): { readonly count: number; readonly bad: boolean } | null {
  const failed = rows.filter((r) => r.status === "failed").length;
  if (failed > 0) return { count: failed, bad: true };
  const busy = rows.filter(isBusy).length;
  return busy > 0 ? { count: busy, bad: false } : null;
}

/** The phone's pill over the map while the shelf's sheet is closed:
 *  "Optimizing 2 files" while any work, else "1 not optimized"; null when
 *  there is nothing to say. */
export function pillView(rows: readonly ShelfRow[]): {
  readonly text: string;
  readonly busy: boolean;
  readonly bad: boolean;
} | null {
  const busy = rows.filter(isBusy).length;
  const failed = rows.filter((r) => r.status === "failed").length;
  if (busy > 0) {
    return { text: `Optimizing ${filesWord(busy)}`, busy: true, bad: false };
  }
  if (failed > 0) {
    return { text: `${String(failed)} not optimized`, busy: false, bad: true };
  }
  return null;
}

/** What a full draw depends on: everything but the progress, which a
 *  live update moves alone. */
export function shapeKey(rows: readonly ShelfRow[]): string {
  return rows
    .map((r) =>
      [
        r.id,
        r.status,
        r.name,
        r.reason ?? "",
        r.retryable,
        r.originalBytes,
        r.optimizedBytes ?? "",
        r.estimatedBytes,
        r.queuePosition ?? "",
        r.placesInUse,
        r.canUseOriginal,
      ].join("\u0001"),
    )
    .join("\u0002");
}
