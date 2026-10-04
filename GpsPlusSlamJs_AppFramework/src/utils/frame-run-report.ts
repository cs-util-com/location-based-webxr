/**
 * The frame recorder's phone-readable summary and its paste-able export
 * (globe zoom performance plan 2026-10-03-2017, §4.1 "Usable on a phone"
 * and "The export"; DEC-PERF-1, DEC-PERF-3; PERF-0).
 *
 * Pure text and data: the page that shows the summary, and the Copy and
 * Download buttons that carry the export, are the globe lab's (PERF-1).
 *
 * @see frame-run-report.ts.md
 */

import {
  ATTRIBUTION_KS,
  ATTRIBUTION_MIN_HITCH_FRAMES,
  attributionVerdicts,
  poolAttributionCounts,
  type AttributionCounts,
  type AttributionVerdictOptions,
  type CauseVerdict,
} from './frame-attribution.js';
import type { FrameRunSummary } from './frame-run.js';
import {
  FRAME_TARGET,
  FRAME_TARGET_HANDFULS,
  checkFrameTarget,
  type FrameTarget,
} from './frame-target.js';

/** Phone width: no summary line is longer (DEC-PERF-1). */
export const SUMMARY_MAX_LINE_CHARS = 40;

/** The export's schema tag; bump it when a field changes meaning. */
export const FRAME_EXPORT_SCHEMA = 'frame-export/1';

/** Causes named in the on-screen summary (plan §4.1: the three strongest). */
const SUMMARY_CAUSES = 3;
/** Supported or provisional causes per run, with their raw counts. */
const EXPORT_CAUSES = 3;
/** Worst frames across all runs in the export (plan §4.1). */
const EXPORT_WORST = 20;
/** A device string longer than this is cut (a user agent is about 150). */
const DEVICE_STRING_MAX = 500;

export interface FrameReportOptions {
  /** Default DEC-PERF-3's {@link FRAME_TARGET}. */
  readonly target?: FrameTarget;
  /** Default 3 / 5 / 10. */
  readonly handfuls?: readonly number[];
  /** Attribution `k` values and minimum hitch frames; the plan's by default. */
  readonly verdicts?: AttributionVerdictOptions;
}

const ms1 = (v: number | null) => (v === null ? '-' : v.toFixed(1));

/** Cuts `text` to `width`, marking the cut with a final "~". */
function fit(text: string, width = SUMMARY_MAX_LINE_CHARS): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}~`;
}

/** Joins tokens with " · ", starting a new line before one that would not fit. */
function wrap(tokens: readonly string[]): string[] {
  const lines: string[] = [];
  let line = '';
  for (const raw of tokens) {
    const token = fit(raw);
    const joined = line === '' ? token : `${line} · ${token}`;
    if (joined.length <= SUMMARY_MAX_LINE_CHARS) line = joined;
    else {
      lines.push(line);
      line = token;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

const strongCauses = (verdicts: readonly CauseVerdict[]) =>
  verdicts.filter((v) => v.status !== 'unsupported');

/**
 * The compact text shown on the phone after a run: every line at most
 * {@link SUMMARY_MAX_LINE_CHARS} characters.
 *
 * @throws RangeError when the run did not count the target's thresholds
 *   (see `checkFrameTarget`).
 */
export function formatFrameRunSummary(
  label: string,
  summary: FrameRunSummary,
  options: FrameReportOptions = {}
): string {
  const { stats } = summary;
  const verdict = checkFrameTarget(
    stats.over,
    options.target ?? FRAME_TARGET,
    options.handfuls ?? FRAME_TARGET_HANDFULS
  );
  const head = [label === '' ? 'run' : label, `${stats.count} frames`];
  if (stats.refreshIntervalMs !== null) {
    head.push(`${(1000 / stats.refreshIntervalMs).toFixed(1)} Hz`);
  }
  const lines = [
    ...wrap(head),
    ...wrap([
      `p50 ${ms1(stats.p50Ms)}`,
      `p95 ${ms1(stats.p95Ms)}`,
      `p99 ${ms1(stats.p99Ms)} ms`,
    ]),
    ...wrap([
      `max ${ms1(stats.maxMs)} ms`,
      `mean ${ms1(stats.meanMs)} ms`,
      ...(stats.droppedFrames === null
        ? []
        : [`dropped ${stats.droppedFrames}`]),
      ...(stats.rejected > 0 ? [`refused ${stats.rejected}`] : []),
    ]),
    ...wrap(stats.over.map((o) => `>${o.thresholdMs} ${o.count}`)),
    fit(
      `${verdict.pass ? 'PASS' : 'FAIL'}: ${verdict.overHard} >${verdict.target.hardMs} ms, ` +
        `${verdict.overSoft} >${verdict.target.softMs} ms (max ${verdict.target.softAllowed})`
    ),
    ...wrap(
      verdict.handfuls.map(
        (h, i) =>
          `${i === 0 ? 'handful ' : ''}${h.allowed} ${h.pass ? 'PASS' : 'FAIL'}`
      )
    ),
  ];
  const causes = strongCauses(
    attributionVerdicts(summary.attribution, options.verdicts)
  ).slice(0, SUMMARY_CAUSES);
  if (causes.length === 0) lines.push('causes: none supported');
  else {
    lines.push('causes:');
    causes.forEach((c, i) => {
      lines.push(
        fit(
          `${i + 1}. ${c.kind} ${c.status} ${c.supportedCells}/${c.totalCells}`
        )
      );
    });
  }
  return lines.join('\n');
}

/** A device-block value as the export carries it. */
type DeviceValue = string | number | boolean | null;

export interface FrameExportInput extends FrameReportOptions {
  /**
   * Who and what ran (plan §4.1, DEC-PERF-1): user agent, GPU strings, DPR,
   * viewport, the hash flags, extensions, build. Opaque to this module.
   */
  readonly device: Readonly<Record<string, DeviceValue>>;
  readonly runs: readonly {
    readonly label: string;
    readonly summary: FrameRunSummary;
  }[];
  /** Worst frames kept across all runs. Default 20. */
  readonly worstCount?: number;
  /**
   * Supported or provisional causes per run, with their raw counts.
   * Default 3. Every kind, whatever its status, is in `pooled`.
   */
  readonly causesPerRun?: number;
}

/** A ratio as JSON can carry it: rounded, `"inf"` for never-in-a-normal-frame, `null` when undefined. */
type ExportRatio = number | 'inf' | null;

interface FrameExportCause {
  readonly kind: string;
  readonly status: CauseVerdict['status'];
  /** Supported cells over all cells, e.g. "12/27". */
  readonly cells: string;
  /** The largest ratio over the cells. */
  readonly maxRatio: ExportRatio;
  /** `[threshold][lag] = [inHitch, inNormal]`, in the run's threshold and lag order. */
  readonly counts: readonly (readonly (readonly [number, number])[])[];
}

interface FrameExportRun {
  readonly label: string;
  readonly frames: number;
  readonly rejected: number;
  readonly refreshIntervalMs: number | null;
  readonly dropped: number | null;
  readonly overflow: number;
  readonly ms: {
    readonly min: number | null;
    readonly mean: number | null;
    readonly p50: number | null;
    readonly p95: number | null;
    readonly p99: number | null;
    readonly max: number | null;
  };
  /**
   * Threshold (ms) -> intervals strictly over it. These are also the
   * attribution join's hitch frames (the run feeds both the same frames);
   * its normal frames are `frames` minus these.
   */
  readonly over: Readonly<Record<string, number>>;
  readonly pass: boolean;
  /** Handful -> pass. */
  readonly handfuls: Readonly<Record<string, boolean>>;
  /** The join's lag windows, frames: the order of each cause's `counts` rows. */
  readonly lags: readonly number[];
  readonly causes: readonly FrameExportCause[];
}

export interface FrameExport {
  readonly schema: string;
  readonly device: Readonly<Record<string, DeviceValue>>;
  readonly target: FrameTarget & { readonly handfuls: readonly number[] };
  /** The attribution parameters the causes were judged with. */
  readonly attribution: {
    readonly ks: readonly number[];
    readonly minHitchFrames: number;
  };
  readonly runs: readonly FrameExportRun[];
  /**
   * The attribution join over ALL runs (`poolAttributionCounts`), with
   * EVERY event kind: a warm run that meets the target has at most 5
   * frames over 33 ms, so a cause often reaches the minimum of hitch
   * frames only pooled. `null` without runs.
   */
  readonly pooled: {
    readonly runs: number;
    readonly frames: number;
    /** Threshold (ms) -> hitch frames; normal frames are `frames` minus these. */
    readonly hitchFrames: Readonly<Record<string, number>>;
    readonly lags: readonly number[];
    readonly causes: readonly FrameExportCause[];
  } | null;
  readonly worst: readonly {
    readonly run: number;
    readonly frame: number;
    readonly ms: number;
    readonly events: readonly string[];
  }[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const msOut = (v: number | null) => (v === null ? null : round2(v));

function ratioOut(r: number | null): ExportRatio {
  if (r === null || Number.isNaN(r)) return null;
  return r === Infinity ? 'inf' : round2(r);
}

function deviceOut(device: Readonly<Record<string, DeviceValue>>) {
  const out: Record<string, DeviceValue> = {};
  for (const [key, value] of Object.entries(device)) {
    if (typeof value === 'string') out[key] = value.slice(0, DEVICE_STRING_MAX);
    else if (typeof value === 'number')
      out[key] = Number.isFinite(value) ? value : null;
    else if (typeof value === 'boolean') out[key] = value;
    else out[key] = null;
  }
  return out;
}

function causeOut(
  verdict: CauseVerdict,
  counts: AttributionCounts
): FrameExportCause {
  const k = counts.kinds[verdict.kind]!;
  let maxRatio: number | null = null;
  for (const cell of verdict.cells) {
    if (cell.ratio !== null && (maxRatio === null || cell.ratio > maxRatio)) {
      maxRatio = cell.ratio;
    }
  }
  return {
    kind: verdict.kind,
    status: verdict.status,
    cells: `${verdict.supportedCells}/${verdict.totalCells}`,
    maxRatio: ratioOut(maxRatio),
    counts: k.inHitch.map((row, ti) =>
      row.map((inHitch, li) => [inHitch, k.inNormal[ti]![li]!] as const)
    ),
  };
}

function nonNegativeInteger(name: string, n: number): number {
  if (!(Number.isInteger(n) && n >= 0)) {
    throw new RangeError(
      `${name} must be a non-negative integer, got ${String(n)}`
    );
  }
  return n;
}

/** The export's settings with their defaults applied. */
interface ExportSettings {
  readonly target: FrameTarget;
  readonly handfuls: readonly number[];
  readonly verdicts: AttributionVerdictOptions | undefined;
  readonly causesPerRun: number;
}

function runOut(
  label: string,
  summary: FrameRunSummary,
  settings: ExportSettings
): FrameExportRun {
  const { stats, attribution } = summary;
  const verdict = checkFrameTarget(
    stats.over,
    settings.target,
    settings.handfuls
  );
  return {
    label,
    frames: stats.count,
    rejected: stats.rejected,
    refreshIntervalMs: msOut(stats.refreshIntervalMs),
    dropped: stats.droppedFrames,
    overflow: stats.overflowCount,
    ms: {
      min: msOut(stats.minMs),
      mean: msOut(stats.meanMs),
      p50: msOut(stats.p50Ms),
      p95: msOut(stats.p95Ms),
      p99: msOut(stats.p99Ms),
      max: msOut(stats.maxMs),
    },
    over: Object.fromEntries(
      stats.over.map((o) => [String(o.thresholdMs), o.count])
    ),
    pass: verdict.pass,
    handfuls: Object.fromEntries(
      verdict.handfuls.map((h) => [String(h.allowed), h.pass])
    ),
    lags: [...attribution.lags],
    causes: strongCauses(attributionVerdicts(attribution, settings.verdicts))
      .slice(0, settings.causesPerRun)
      .map((v) => causeOut(v, attribution)),
  };
}

function worstOut(
  runs: FrameExportInput['runs'],
  worstCount: number
): FrameExport['worst'] {
  return runs
    .flatMap(({ summary }, run) =>
      summary.worst.map((w) => ({
        run,
        frame: w.frame,
        ms: round2(w.ms),
        events: [...w.events],
      }))
    )
    .sort((a, b) => b.ms - a.ms || a.run - b.run || a.frame - b.frame)
    .slice(0, worstCount);
}

/**
 * The export: compact, valid JSON once stringified (no NaN, no Infinity),
 * with the device block, the target, per run the statistics, the target
 * verdict and the strongest causes with their raw counts, the join pooled
 * over all runs, and the worst frames across all runs with their events.
 *
 * @throws RangeError as {@link formatFrameRunSummary}, for a negative or
 *   non-integer `worstCount` / `causesPerRun`, or for runs counted at
 *   different thresholds or lags (they cannot be pooled).
 */
export function buildFrameExport(input: FrameExportInput): FrameExport {
  const settings: ExportSettings = {
    target: input.target ?? FRAME_TARGET,
    handfuls: input.handfuls ?? FRAME_TARGET_HANDFULS,
    verdicts: input.verdicts,
    causesPerRun: nonNegativeInteger(
      'causesPerRun',
      input.causesPerRun ?? EXPORT_CAUSES
    ),
  };
  const worstCount = nonNegativeInteger(
    'worstCount',
    input.worstCount ?? EXPORT_WORST
  );
  return {
    schema: FRAME_EXPORT_SCHEMA,
    device: deviceOut(input.device),
    target: { ...settings.target, handfuls: [...settings.handfuls] },
    attribution: {
      ks: [...(input.verdicts?.ks ?? ATTRIBUTION_KS)],
      minHitchFrames:
        input.verdicts?.minHitchFrames ?? ATTRIBUTION_MIN_HITCH_FRAMES,
    },
    runs: input.runs.map(({ label, summary }) =>
      runOut(label, summary, settings)
    ),
    pooled: pooledOut(input),
    worst: worstOut(input.runs, worstCount),
  };
}

function pooledOut(input: FrameExportInput): FrameExport['pooled'] {
  if (input.runs.length === 0) return null;
  const pooled = poolAttributionCounts(
    input.runs.map((r) => r.summary.attribution)
  );
  return {
    runs: input.runs.length,
    frames: pooled.frames,
    hitchFrames: Object.fromEntries(
      pooled.thresholdsMs.map((t, i) => [String(t), pooled.hitchFrames[i]!])
    ),
    lags: [...pooled.lags],
    causes: attributionVerdicts(pooled, input.verdicts).map((v) =>
      causeOut(v, pooled)
    ),
  };
}
