/**
 * The `?perf=1` perf log: a bounded record of the frames since load and the
 * plain-text report the "Copy perf log" button copies.
 *
 * WHY THIS EXISTS. The woods governor (`gps-plus-slam-osm/three`'s
 * `woods-governor.ts`) is judged on a real phone, and its one-line readout
 * (`woods-readout.ts`) shows only the present. This keeps the session's
 * timeline (every chained frame interval, every burst start, every share
 * change) and the device it ran on, as text a person can paste into a chat.
 *
 * PURE. The view feeds the recorder and supplies the device, settings and
 * readout; the report is built here, so it is pinned in node without a GPU.
 * The DOM half (the button, the device probe, the fallback) is
 * `perf-log-panel.ts`.
 *
 * PRIVATE BY CONSTRUCTION. Nothing here sees a location, a camera position,
 * a tile or a cell: the inputs are times, counts and device facts, and the
 * only part of the URL is the three knobs `pickQueryKnobs` keeps.
 *
 * @see perf-log.ts.md
 */

import type { WoodsGovernorMode } from "gps-plus-slam-osm/three";

import { describeDrawCost, type DrawCost } from "./draw-cost.js";

/** How many entries each timeline keeps before dropping the oldest. */
export const PERF_LOG_LIMITS = Object.freeze({
  intervals: 3000,
  bursts: 1000,
  shareChanges: 500,
});

export type PerfLogLimits = Readonly<
  Record<keyof typeof PERF_LOG_LIMITS, number>
>;

/** A ring of the newest `capacity` items, with a count of those dropped. */
export interface Ring<T> {
  push(item: T): void;
  /** The kept items, oldest first (a copy). */
  items(): T[];
  dropped(): number;
}

export function createRing<T>(capacity: number): Ring<T> {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(
      `ring capacity must be a positive integer: ${capacity}`,
    );
  }
  const slots: T[] = [];
  let start = 0;
  let dropped = 0;
  return {
    push(item) {
      if (slots.length < capacity) {
        slots.push(item);
        return;
      }
      slots[start] = item;
      start = (start + 1) % capacity;
      dropped += 1;
    },
    items: () => [...slots.slice(start), ...slots.slice(0, start)],
    dropped: () => dropped,
  };
}

/** One move of the woods' share, and the governor's state just after it. */
export interface ShareChange {
  readonly atMs: number;
  readonly from: number;
  readonly to: number;
  readonly mode: WoodsGovernorMode;
  readonly averageMs: number | undefined;
}

/** The recorder's content: times are ms from page start (rAF timestamps). */
export interface PerfTimeline {
  /** `[atMs, intervalMs]` of the newest chained intervals, oldest first. */
  readonly intervals: readonly (readonly [number, number])[];
  readonly droppedIntervals: number;
  /** Every chained interval since load, kept or dropped. */
  readonly intervalCount: number;
  /** The sum of every chained interval since load (for the mean). */
  readonly intervalSumMs: number;
  /** The newest unchained frames: each starts a burst after an idle pause. */
  readonly bursts: readonly number[];
  readonly droppedBursts: number;
  readonly shareChanges: readonly ShareChange[];
  readonly droppedShareChanges: number;
}

export interface PerfRecorder {
  /** One drawn frame at `atMs`; `chained` as the governor reads it. */
  frame(atMs: number, chained: boolean): void;
  shareChange(change: ShareChange): void;
  snapshot(): PerfTimeline;
}

export function createPerfRecorder(
  limits: PerfLogLimits = PERF_LOG_LIMITS,
): PerfRecorder {
  const intervals = createRing<readonly [number, number]>(limits.intervals);
  const bursts = createRing<number>(limits.bursts);
  const shareChanges = createRing<ShareChange>(limits.shareChanges);
  let lastMs: number | undefined;
  let count = 0;
  let sum = 0;
  return {
    frame(atMs, chained) {
      if (!Number.isFinite(atMs)) return;
      const before = lastMs;
      lastMs = atMs;
      // The governor's rule: only a chained frame's interval is a frame
      // time; an unchained one follows an idle pause and starts a burst.
      if (!chained || before === undefined) {
        bursts.push(atMs);
        return;
      }
      const ms = atMs - before;
      if (!(ms > 0)) return;
      intervals.push([atMs, ms]);
      count += 1;
      sum += ms;
    },
    shareChange(change) {
      shareChanges.push(change);
    },
    snapshot: () => ({
      intervals: intervals.items(),
      droppedIntervals: intervals.dropped(),
      intervalCount: count,
      intervalSumMs: sum,
      bursts: bursts.items(),
      droppedBursts: bursts.dropped(),
      shareChanges: shareChanges.items(),
      droppedShareChanges: shareChanges.dropped(),
    }),
  };
}

/** The nearest-rank `q` quantile of an ascending list, undefined if empty. */
export function percentile(
  sortedAsc: readonly number[],
  q: number,
): number | undefined {
  if (sortedAsc.length === 0) return undefined;
  const rank = Math.min(
    sortedAsc.length,
    Math.max(1, Math.ceil(q * sortedAsc.length)),
  );
  return sortedAsc[rank - 1];
}

export interface FrameSummary {
  /** Every chained interval since load. */
  readonly frames: number;
  /** The intervals still in the ring, which the percentiles read. */
  readonly retained: number;
  /** The mean of every interval since load. */
  readonly meanMs: number | undefined;
  readonly p50Ms: number | undefined;
  readonly p95Ms: number | undefined;
  readonly p99Ms: number | undefined;
}

export function summarizeFrames(timeline: PerfTimeline): FrameSummary {
  const sorted = timeline.intervals.map(([, ms]) => ms).sort((a, b) => a - b);
  return {
    frames: timeline.intervalCount,
    retained: sorted.length,
    meanMs:
      timeline.intervalCount > 0
        ? timeline.intervalSumMs / timeline.intervalCount
        : undefined,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  };
}

const KNOBS = ["woodsauto", "treeform", "perf"] as const;

export type QueryKnobs = Readonly<
  Record<(typeof KNOBS)[number], string | null>
>;

/**
 * The woods knobs from a query string, and nothing else: the link also
 * carries the place and the camera, which the report must never contain.
 */
export function pickQueryKnobs(search: string): QueryKnobs {
  const params = new URLSearchParams(search);
  return {
    woodsauto: params.get("woodsauto"),
    treeform: params.get("treeform"),
    perf: params.get("perf"),
  };
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** What the page can learn about the device, null where it is hidden. */
export interface PerfDevice {
  readonly userAgent: string;
  readonly devicePixelRatio: number;
  readonly screenCss: Size | null;
  readonly screenDevice: Size | null;
  readonly canvasCss: Size | null;
  readonly canvasDevice: Size | null;
  readonly hardwareConcurrency: number | null;
  readonly deviceMemoryGb: number | null;
  readonly gpuRenderer: string | null;
  readonly gpuVendor: string | null;
  readonly pointer: "coarse" | "fine" | "none" | "unknown";
}

export interface PerfReportInput {
  /** When the report is taken, ms from page start. */
  readonly nowMs: number;
  readonly device: PerfDevice;
  readonly settings: {
    readonly query: QueryKnobs;
    /** Whether the governor may thin the woods (`readWoodsKnobs().auto`). */
    readonly governorOn: boolean;
    /** The governor's constants (`WOODS_GOVERNOR`). */
    readonly governor: unknown;
  };
  readonly timeline: PerfTimeline;
  readonly now: {
    readonly share: number;
    readonly mode: WoodsGovernorMode;
    readonly averageMs: number | undefined;
    /** The readout line as shown (`describeWoodsReadout`). */
    readonly readout: string;
    readonly drawCost: DrawCost | undefined;
    readonly inventedTrees: number;
  };
}

const JSON_HEADING = "== JSON ==";

/** A time to a tenth of a millisecond; null for an unknown or non-finite one. */
const tenth = (value: number | undefined): number | null =>
  value === undefined || !Number.isFinite(value)
    ? null
    : Math.round(value * 10) / 10;

const ms = (value: number | undefined): string =>
  value === undefined || !Number.isFinite(value) ? "-" : value.toFixed(1);

/** One line of free text: a user agent or GPU name cannot break the layout. */
const line = (text: string | null): string =>
  text === null ? "-" : text.replace(/[\r\n\t]+/g, " ");

const size = (value: Size | null): string =>
  value === null ? "-" : `${value.width}x${value.height}`;

const percent = (share: number): string => `${Math.round(share * 100)} %`;

/**
 * The report: a few human lines per section (summary, readout, device,
 * settings), then the whole of it, timeline included, as one JSON line
 * after `== JSON ==`, the last section, so `reportJson` can always find it.
 */
export function buildPerfReport(input: PerfReportInput): string {
  const { device, settings, timeline, now } = input;
  const summary = summarizeFrames(timeline);
  const query = KNOBS.map(
    (knob) => `${knob}=${settings.query[knob] ?? "(unset)"}`,
  ).join(" ");
  const cost = describeDrawCost(now.drawCost);
  const json = {
    format: "osmdemo-perf-log/1",
    nowMs: tenth(input.nowMs),
    summary: {
      frames: summary.frames,
      retained: summary.retained,
      meanMs: tenth(summary.meanMs),
      p50Ms: tenth(summary.p50Ms),
      p95Ms: tenth(summary.p95Ms),
      p99Ms: tenth(summary.p99Ms),
    },
    now: {
      share: now.share,
      mode: now.mode,
      averageMs: tenth(now.averageMs),
      readout: now.readout,
      drawCost: now.drawCost ?? null,
      inventedTrees: now.inventedTrees,
    },
    device,
    settings,
    timeline: {
      intervals: timeline.intervals.map(([atMs, interval]) => [
        tenth(atMs),
        tenth(interval),
      ]),
      droppedIntervals: timeline.droppedIntervals,
      bursts: timeline.bursts.map(tenth),
      droppedBursts: timeline.droppedBursts,
      shareChanges: timeline.shareChanges.map((change) => ({
        atMs: tenth(change.atMs),
        from: change.from,
        to: change.to,
        mode: change.mode,
        averageMs: tenth(change.averageMs),
      })),
      droppedShareChanges: timeline.droppedShareChanges,
    },
  };
  return [
    "OsmDemo perf log (woods governor)",
    "Contains no location, camera position, tile or cell ids; of the URL only the woodsauto, treeform and perf knobs.",
    "",
    "== Summary ==",
    `taken at ${ms(input.nowMs)} ms after page start`,
    `frames ${summary.frames} chained (${summary.retained} kept, ${timeline.droppedIntervals} dropped)` +
      ` · mean ${ms(summary.meanMs)} ms · p50 ${ms(summary.p50Ms)} ms` +
      ` · p95 ${ms(summary.p95Ms)} ms · p99 ${ms(summary.p99Ms)} ms`,
    `bursts ${timeline.bursts.length + timeline.droppedBursts}` +
      ` · share changes ${timeline.shareChanges.length + timeline.droppedShareChanges}`,
    `woods ${percent(now.share)} (${now.mode}) · governor average ${ms(now.averageMs)} ms`,
    "",
    "== Readout ==",
    line(now.readout),
    `${cost === "" ? "draw cost -" : cost} · ${now.inventedTrees.toLocaleString("en-US")} invented trees`,
    "",
    "== Device ==",
    `user agent ${line(device.userAgent)}`,
    `dpr ${device.devicePixelRatio}` +
      ` · screen ${size(device.screenCss)} CSS (${size(device.screenDevice)} device)` +
      ` · canvas ${size(device.canvasCss)} CSS (${size(device.canvasDevice)} device)`,
    `cores ${device.hardwareConcurrency ?? "-"}` +
      ` · memory ${device.deviceMemoryGb === null ? "-" : `${device.deviceMemoryGb} GB`}` +
      ` · pointer ${device.pointer}`,
    `gpu ${line(device.gpuRenderer)} · vendor ${line(device.gpuVendor)}`,
    "",
    "== Settings ==",
    `query ${query}`,
    `governor ${settings.governorOn ? "on" : "off"} · constants ${JSON.stringify(settings.governor)}`,
    "",
    JSON_HEADING,
    JSON.stringify(json),
    "",
  ].join("\n");
}

/**
 * The JSON block of a report; throws when there is none or it is broken.
 * CRLF line ends (a pasted copy from a Windows clipboard) read as LF.
 */
export function reportJson(report: string): unknown {
  const text = report.replace(/\r\n/g, "\n");
  const marker = `\n${JSON_HEADING}\n`;
  const at = text.lastIndexOf(marker);
  if (at < 0) throw new Error("not a perf log: no JSON block");
  const rest = text.slice(at + marker.length);
  const end = rest.indexOf("\n");
  return JSON.parse(end < 0 ? rest : rest.slice(0, end)) as unknown;
}
