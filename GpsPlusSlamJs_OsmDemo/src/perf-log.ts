/**
 * The `?perf=1` perf log: a bounded record of the frames since load and the
 * plain-text report the "Copy perf log" button copies.
 *
 * WHY THIS EXISTS. The woods governor (`gps-plus-slam-osm/three`'s
 * `woods-governor.ts`) is judged on a real phone, and its one-line readout
 * (`woods-readout.ts`) shows only the present. This keeps the session's
 * timeline (every chained frame interval, every burst start with its draw
 * cost and its slowest frame's, every share change) and the device it ran
 * on, as text a person can paste into a chat.
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

import { percentileOfSorted } from "gps-plus-slam-app-framework/utils/percentile";
import {
  WOODS_GOVERNOR,
  type WoodsGovernorMode,
} from "gps-plus-slam-osm/three";

import { describeDrawCost, type DrawCost } from "./draw-cost.js";

/** How many entries each timeline keeps before dropping the oldest. */
const PERF_LOG_LIMITS = Object.freeze({
  intervals: 3000,
  bursts: 1000,
  shareChanges: 500,
  sunSteps: 1000,
});

/** The rings' sizes; the sun steps' is optional (the default above). */
export type PerfLogLimits = Readonly<
  Record<Exclude<keyof typeof PERF_LOG_LIMITS, "sunSteps">, number>
> & { readonly sunSteps?: number };

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
interface ShareChange {
  readonly atMs: number;
  readonly from: number;
  readonly to: number;
  readonly mode: WoodsGovernorMode;
  readonly averageMs: number | undefined;
}

/** A burst's slowest chained interval, with the frame drawn before it. */
interface SlowestFrame {
  /** When the interval ended (ms from page start). */
  readonly atMs: number;
  readonly ms: number;
  /** The cost of the frame drawn just before, the frame it measured. */
  readonly drawCost: DrawCost | null;
}

/** One burst: its first frame and, once it has one, its slowest interval. */
interface PerfBurst {
  readonly atMs: number;
  /** What the burst's first frame drew; null until it was drawn. */
  readonly drawCost: DrawCost | null;
  readonly slowest: SlowestFrame | null;
}

/**
 * One sun step, timed under `?perf=1` (`BuildingView.setSunAndLight`). The
 * step's sky readback waits for the GPU to finish everything it was given
 * before, so the view first waits for that with a 1x1 readback of its own
 * and times the two apart: `gpuWaitMs` is the frame in flight, `stepMs`
 * the step's own work (the sky tables, their readback, the bake, the
 * copies).
 */
interface SunStepTiming {
  /** When the step started (ms from page start). */
  readonly atMs: number;
  readonly gpuWaitMs: number;
  readonly stepMs: number;
  /** Whether the step rebuilt every sky table (a new haze visibility). */
  readonly allTables: boolean;
}

/** The recorder's content: times are ms from page start (rAF timestamps). */
export interface PerfTimeline {
  /** `[atMs, intervalMs]` of the newest chained intervals, oldest first. */
  readonly intervals: readonly (readonly [number, number])[];
  readonly droppedIntervals: number;
  /** Every chained interval since load, kept or dropped. */
  readonly intervalCount: number;
  /** The sum of every chained interval since load (for the raw mean). */
  readonly intervalSumMs: number;
  /**
   * The intervals since load the governor leaves out, kept or dropped: one
   * longer than `gapMs` after one that was not.
   */
  readonly longGapCount: number;
  /** The governor's gap: one interval longer says nothing of the device. */
  readonly gapMs: number;
  /** The newest bursts: each starts with an unchained frame after a pause. */
  readonly bursts: readonly PerfBurst[];
  readonly droppedBursts: number;
  readonly shareChanges: readonly ShareChange[];
  readonly droppedShareChanges: number;
  /** The newest sun steps, oldest first. */
  readonly sunSteps: readonly SunStepTiming[];
  readonly droppedSunSteps: number;
}

export interface PerfRecorder {
  /** One frame at `atMs`, before it is drawn; `chained` as the governor reads it. */
  frame(atMs: number, chained: boolean): void;
  /** What the frame just drawn cost (`renderer.info.render` after the render). */
  drawn(cost: DrawCost): void;
  shareChange(change: ShareChange): void;
  /** One sun step, timed (`SunStepTiming`). */
  sunStep(timing: SunStepTiming): void;
  snapshot(): PerfTimeline;
}

interface OpenBurst {
  atMs: number;
  drawCost: DrawCost | null;
  slowest: SlowestFrame | null;
}

const copyBurst = (burst: OpenBurst): PerfBurst => ({
  atMs: burst.atMs,
  drawCost: burst.drawCost,
  slowest: burst.slowest,
});

export function createPerfRecorder(
  limits: PerfLogLimits = PERF_LOG_LIMITS,
  gapMs: number = WOODS_GOVERNOR.gapMs,
): PerfRecorder {
  const intervals = createRing<readonly [number, number]>(limits.intervals);
  const bursts = createRing<OpenBurst>(limits.bursts);
  const shareChanges = createRing<ShareChange>(limits.shareChanges);
  const sunSteps = createRing<SunStepTiming>(
    limits.sunSteps ?? PERF_LOG_LIMITS.sunSteps,
  );
  let lastMs: number | undefined;
  let lastCost: DrawCost | null = null;
  let current: OpenBurst | undefined;
  let count = 0;
  let sum = 0;
  let longGaps = 0;
  let gapBefore = false;

  const interval = (atMs: number, ms: number): void => {
    intervals.push([atMs, ms]);
    count += 1;
    sum += ms;
    // The governor's rule: a gap is left out only when the interval before
    // it was not one, so a steady slow stretch counts once, not per frame.
    const gap = ms > gapMs;
    if (gap && !gapBefore) longGaps += 1;
    gapBefore = gap;
    if (current !== undefined && ms > (current.slowest?.ms ?? 0)) {
      current.slowest = { atMs, ms, drawCost: lastCost };
    }
  };

  return {
    frame(atMs, chained) {
      if (!Number.isFinite(atMs)) return;
      // The governor's rule: a frame not after the last is ignored whole,
      // so the next interval is measured from the same frame as there.
      if (lastMs !== undefined && !(atMs > lastMs)) return;
      const before = lastMs;
      lastMs = atMs;
      // Only a chained frame's interval is a frame time; an unchained one
      // follows an idle pause and starts a burst.
      if (!chained || before === undefined) {
        current = { atMs, drawCost: null, slowest: null };
        bursts.push(current);
      } else {
        interval(atMs, atMs - before);
      }
      // The cost read above was the frame before this one. Cleared, so a
      // render that throws before `drawn()` leaves no older frame's cost
      // to be read as this one's.
      lastCost = null;
    },
    drawn(cost) {
      lastCost = { calls: cost.calls, triangles: cost.triangles };
      if (current !== undefined && current.drawCost === null) {
        current.drawCost = lastCost;
      }
    },
    shareChange(change) {
      shareChanges.push(change);
    },
    sunStep(timing) {
      sunSteps.push({ ...timing });
    },
    snapshot: () => ({
      intervals: intervals.items(),
      droppedIntervals: intervals.dropped(),
      intervalCount: count,
      intervalSumMs: sum,
      longGapCount: longGaps,
      gapMs,
      bursts: bursts.items().map(copyBurst),
      droppedBursts: bursts.dropped(),
      shareChanges: shareChanges.items(),
      droppedShareChanges: shareChanges.dropped(),
      sunSteps: sunSteps.items(),
      droppedSunSteps: sunSteps.dropped(),
    }),
  };
}

/**
 * The nearest-rank `q` quantile of an ascending list, undefined if empty:
 * the framework's rank rule (`percentileOfSorted`), not a copy of it.
 */
export function percentile(
  sortedAsc: readonly number[],
  q: number,
): number | undefined {
  return sortedAsc.length === 0 ? undefined : percentileOfSorted(sortedAsc, q);
}

export interface FrameSummary {
  /** Every chained interval since load. */
  readonly frames: number;
  /** The intervals still in the ring, which the percentiles read. */
  readonly retained: number;
  /**
   * The mean of every interval since load, RAW: lone gaps the governor
   * leaves out (a tab coming back) are in it, `longGaps` says how many.
   */
  readonly rawMeanMs: number | undefined;
  /**
   * Intervals since load the governor leaves out as lone gaps: longer than
   * its `gapMs`, after one that was not.
   */
  readonly longGaps: number;
  readonly p50Ms: number | undefined;
  readonly p95Ms: number | undefined;
  readonly p99Ms: number | undefined;
  /**
   * Whether the timeline is whole since load, so replaying it through the
   * governor gives its share changes: false after any ring dropped one, and
   * false when a frame time is finer than the report's 0.1 ms, since the
   * replay reads the rounded times and could then differ.
   */
  readonly replayable: boolean;
}

/** Whether the report's 0.1 ms rounding leaves a time exactly as it was. */
const onGrid = (atMs: number): boolean => Math.round(atMs * 10) / 10 === atMs;

export function summarizeFrames(timeline: PerfTimeline): FrameSummary {
  const sorted = timeline.intervals.map(([, ms]) => ms).sort((a, b) => a - b);
  return {
    frames: timeline.intervalCount,
    retained: sorted.length,
    rawMeanMs:
      timeline.intervalCount > 0
        ? timeline.intervalSumMs / timeline.intervalCount
        : undefined,
    longGaps: timeline.longGapCount,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    replayable:
      timeline.droppedIntervals === 0 &&
      timeline.droppedBursts === 0 &&
      timeline.droppedShareChanges === 0 &&
      timeline.intervals.every(([atMs]) => onGrid(atMs)) &&
      timeline.bursts.every((burst) => onGrid(burst.atMs)),
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

/** A draw cost in words, `-` when unmeasured or nothing drawn. */
const costText = (cost: DrawCost | null | undefined): string =>
  describeDrawCost(cost ?? undefined) || "-";

const seconds = (atMs: number): string => `${(atMs / 1000).toFixed(1)} s`;

/** How many of the newest bursts the human section lists. */
const BURST_LINES = 10;

function burstLine(burst: PerfBurst): string {
  const start = `at ${seconds(burst.atMs)}: start ${costText(burst.drawCost)}`;
  const slow = burst.slowest;
  return slow === null
    ? `${start} · no chained frame`
    : `${start} · slowest ${ms(slow.ms)} ms at ${seconds(slow.atMs)} after ${costText(slow.drawCost)}`;
}

const burstJson = (burst: PerfBurst): unknown => ({
  atMs: tenth(burst.atMs),
  drawCost: burst.drawCost,
  slowest:
    burst.slowest === null
      ? null
      : {
          atMs: tenth(burst.slowest.atMs),
          ms: tenth(burst.slowest.ms),
          drawCost: burst.slowest.drawCost,
        },
});

function summaryLines(input: PerfReportInput, summary: FrameSummary): string[] {
  const { timeline, now } = input;
  return [
    "== Summary ==",
    `taken at ${ms(input.nowMs)} ms after page start`,
    `frames ${summary.frames} chained (${summary.retained} kept, ${timeline.droppedIntervals} dropped)` +
      ` · raw mean ${ms(summary.rawMeanMs)} ms (${summary.longGaps} lone gaps over ${timeline.gapMs} ms included)` +
      ` · p50 ${ms(summary.p50Ms)} ms · p95 ${ms(summary.p95Ms)} ms · p99 ${ms(summary.p99Ms)} ms`,
    `bursts ${timeline.bursts.length + timeline.droppedBursts}` +
      ` · share changes ${timeline.shareChanges.length + timeline.droppedShareChanges}`,
    summary.replayable
      ? "replayable yes (the timeline is whole since load)"
      : timeline.droppedIntervals +
            timeline.droppedBursts +
            timeline.droppedShareChanges >
          0
        ? "replayable no (a ring dropped its oldest entries)"
        : "replayable no (frame times are finer than 0.1 ms, so a replay is within the rounding)",
    `woods ${percent(now.share)} (${now.mode}) · governor average ${ms(now.averageMs)} ms`,
  ];
}

/** p50, p90 and max of a list of times, in words. */
function spread(times: readonly number[]): string {
  const sorted = [...times].sort((a, b) => a - b);
  return `p50 ${ms(percentile(sorted, 0.5))} · p90 ${ms(percentile(sorted, 0.9))} · max ${ms(sorted.at(-1))} ms`;
}

/**
 * The sun steps' section: how many, the GPU wait before them, and their
 * own time split by whether they rebuilt every sky table.
 */
function sunStepLines(timeline: PerfTimeline): string[] {
  const steps = timeline.sunSteps;
  const total = steps.length + timeline.droppedSunSteps;
  const all = steps.filter((s) => s.allTables);
  const sunOnly = steps.filter((s) => !s.allTables);
  return [
    "== Sun steps ==",
    `${total} sun steps (${all.length} rebuilt every sky table) · ${steps.length} kept`,
    ...(steps.length === 0
      ? []
      : [
          `GPU wait ${spread(steps.map((s) => s.gpuWaitMs))}`,
          `sun only ${spread(sunOnly.map((s) => s.stepMs))}`,
          `every table ${spread(all.map((s) => s.stepMs))}`,
        ]),
  ];
}

function deviceLines(device: PerfDevice): string[] {
  return [
    "== Device ==",
    `user agent ${line(device.userAgent)}`,
    `dpr ${device.devicePixelRatio}` +
      ` · screen ${size(device.screenCss)} CSS (${size(device.screenDevice)} device)` +
      ` · canvas ${size(device.canvasCss)} CSS (${size(device.canvasDevice)} device)`,
    `cores ${device.hardwareConcurrency ?? "-"}` +
      ` · memory ${device.deviceMemoryGb === null ? "-" : `${device.deviceMemoryGb} GB`}` +
      ` · pointer ${device.pointer}`,
    `gpu ${line(device.gpuRenderer)} · vendor ${line(device.gpuVendor)}`,
  ];
}

/** The knobs as `name=value`; a value is free text, so it is one line. */
const queryText = (query: QueryKnobs): string =>
  KNOBS.map((knob) => {
    const value = query[knob];
    return `${knob}=${value === null ? "(unset)" : line(value)}`;
  }).join(" ");

/**
 * The report: a few human lines per section (summary, readout, the newest
 * bursts, device, settings), then the whole of it, timeline included, as
 * one JSON line after `== JSON ==`, the last section, so `reportJson` can
 * always find it.
 */
export function buildPerfReport(input: PerfReportInput): string {
  const { device, settings, timeline, now } = input;
  const summary = summarizeFrames(timeline);
  const cost = costText(now.drawCost);
  const json = {
    format: "osmdemo-perf-log/2",
    nowMs: tenth(input.nowMs),
    summary: {
      frames: summary.frames,
      retained: summary.retained,
      rawMeanMs: tenth(summary.rawMeanMs),
      longGaps: summary.longGaps,
      p50Ms: tenth(summary.p50Ms),
      p95Ms: tenth(summary.p95Ms),
      p99Ms: tenth(summary.p99Ms),
      replayable: summary.replayable,
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
      bursts: timeline.bursts.map(burstJson),
      droppedBursts: timeline.droppedBursts,
      shareChanges: timeline.shareChanges.map((change) => ({
        atMs: tenth(change.atMs),
        from: change.from,
        to: change.to,
        mode: change.mode,
        averageMs: tenth(change.averageMs),
      })),
      droppedShareChanges: timeline.droppedShareChanges,
      sunSteps: timeline.sunSteps.map((s) => [
        tenth(s.atMs),
        tenth(s.gpuWaitMs),
        tenth(s.stepMs),
        s.allTables ? 1 : 0,
      ]),
      droppedSunSteps: timeline.droppedSunSteps,
    },
  };
  return [
    "OsmDemo perf log (woods governor)",
    "Contains no location, camera position, tile or cell ids; of the URL only the woodsauto, treeform and perf knobs.",
    "",
    ...summaryLines(input, summary),
    "",
    "== Readout ==",
    line(now.readout),
    `${cost === "-" ? "draw cost -" : cost} · ${now.inventedTrees.toLocaleString("en-US")} invented trees`,
    "",
    "== Bursts ==",
    `the newest ${Math.min(BURST_LINES, timeline.bursts.length)} of ${timeline.bursts.length + timeline.droppedBursts}; the JSON has every kept one`,
    ...timeline.bursts.slice(-BURST_LINES).map(burstLine),
    "",
    ...sunStepLines(timeline),
    "",
    ...deviceLines(device),
    "",
    "== Settings ==",
    `query ${queryText(settings.query)}`,
    `governor ${settings.governorOn ? "on" : "off"} · constants ${JSON.stringify(settings.governor)}`,
    "",
    JSON_HEADING,
    JSON.stringify(json),
    "",
  ].join("\n");
}

/**
 * The JSON block of a report; throws when there is none or it is broken.
 * CRLF line ends (a pasted copy from a Windows clipboard) read as LF. It
 * checks no format version: a reader that relies on the shape checks
 * `format` (`osmdemo-perf-log/2`) itself first.
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
