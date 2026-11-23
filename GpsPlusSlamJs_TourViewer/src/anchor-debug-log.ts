/**
 * The anchor section of a visitor's `?debug=1` Copy log: the recent
 * `[DeferredAnchors]` log lines (commits, window opened and closed, follow
 * start and end), and over the last passes the anchor pass time, the
 * traversals per pass and the frame time, each with its sample count.
 * The phone field test of the deferred anchors reads its pass criteria
 * from it (pass p95, frame-time p95 with the deferral on and off).
 *
 * A diagnostic buffer beside the store, like the travelling-box log: it is
 * fed by the framework's pass observer and log stream, both of which run
 * only while the page is a visitor's with `?debug=1`.
 *
 * @see anchor-debug-log.ts.md
 */

import {
  observeDeferredAnchorPasses,
  type DeferredAnchorPassSample,
} from "gps-plus-slam-app-framework/ar/deferred-anchors";
import {
  subscribeToLogs,
  type LogEntry,
} from "gps-plus-slam-app-framework/utils/logger";
import { percentileOfSorted } from "gps-plus-slam-app-framework/utils/percentile";

/** Passes kept for the summaries: about 30 s at 60 frames a second. */
export const ANCHOR_LOG_PASSES = 1800;
/** `[DeferredAnchors]` lines kept (the oldest go first). */
export const ANCHOR_LOG_LINES = 200;
/** The readout recomputes its line at most this often (ms). */
const READOUT_EVERY_MS = 1000;
const TAG = "DeferredAnchors";

/** Nearest-rank p50 and p95, the max, the mean and how many samples. */
export interface SampleSummary {
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly mean: number;
  readonly count: number;
}

/**
 * The summary of the finite values of `values` (any order, not mutated);
 * null when none is finite. Percentiles are the framework's nearest rank,
 * so each is a value that occurred.
 */
export function summarizeSamples(
  values: ArrayLike<number>,
): SampleSummary | null {
  const sorted = Float64Array.from(values)
    .filter((v) => Number.isFinite(v))
    .sort();
  const count = sorted.length;
  if (count === 0) return null;
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    p50: percentileOfSorted(sorted, 0.5),
    p95: percentileOfSorted(sorted, 0.95),
    max: sorted[count - 1]!,
    mean: sum / count,
    count,
  };
}

export interface AnchorDebugLog {
  /** One production pass, as the framework's observer hands it. */
  pass(sample: DeferredAnchorPassSample): void;
  /** One framework log entry; entries of other tags are ignored. */
  entry(entry: LogEntry): void;
  /** The section the Copy log appends. */
  text(): string;
  /** The `?debug=1` readout's line (empty before the first pass). */
  readout(nowMs: number): string[];
  /** Empty the buffers (after a copy or a download, with the travel log). */
  clear(): void;
}

/**
 * @param options.passes how many passes the summaries cover.
 * @param options.lines how many log lines are kept.
 * @throws RangeError for a size that is no positive integer.
 */
export function createAnchorDebugLog(
  options: { readonly passes?: number; readonly lines?: number } = {},
): AnchorDebugLog {
  const capacity = options.passes ?? ANCHOR_LOG_PASSES;
  const lineCap = options.lines ?? ANCHOR_LOG_LINES;
  for (const [name, n] of [
    ["passes", capacity],
    ["lines", lineCap],
  ] as const) {
    if (!(Number.isInteger(n) && n > 0)) {
      throw new RangeError(
        `anchor-debug-log: ${name} must be a positive integer, got ${String(n)}`,
      );
    }
  }
  const passMs = new Float64Array(capacity);
  const traversals = new Float64Array(capacity);
  const frameMs = new Float64Array(capacity);
  let next = 0;
  let kept = 0;
  let seen = 0;
  let deferring: boolean | null = null;
  let lines: string[] = [];
  let droppedLines = 0;
  let readoutAtMs = -Infinity;
  let readoutLine: string[] = [];

  const window = (ring: Float64Array): Float64Array => ring.subarray(0, kept);

  return {
    pass(sample) {
      // A non-finite value is kept as NaN, so its column skips it alone.
      const finite = (v: number): number => (Number.isFinite(v) ? v : NaN);
      passMs[next] = finite(sample.passMs);
      traversals[next] = finite(sample.counts.traversals);
      // The frame loop's first frame has no dt: no frame time.
      frameMs[next] = sample.dt > 0 ? finite(sample.dt * 1000) : NaN;
      next = (next + 1) % capacity;
      kept = Math.min(kept + 1, capacity);
      seen += 1;
      deferring = sample.deferring;
    },
    entry(entry) {
      if (entry.tag !== TAG) return;
      lines.push(`${clockOf(entry.timestamp)} ${entry.message}`);
      if (lines.length > lineCap) {
        lines.shift();
        droppedLines += 1;
      }
    },
    text() {
      const out = [
        "--- anchors ---",
        `deferral ${deferring === null ? "-" : deferring ? "on" : "off (anchors=0)"}`,
        `passes ${String(seen)} seen, last ${String(kept)} summarized`,
        `pass ms ${summaryText(summarizeSamples(window(passMs)), 3)}`,
        `traversals per pass ${traversalText(summarizeSamples(window(traversals)))}`,
        `frame ms ${summaryText(summarizeSamples(window(frameMs)), 1)}`,
        `lines ${String(lines.length)}${droppedLines > 0 ? `, ${String(droppedLines)} older dropped` : ""}`,
        ...lines,
      ];
      return out.join("\n");
    },
    readout(nowMs) {
      if (kept === 0) return [];
      // Sorting the rings is cheap but not free: once a second is enough
      // for a line a person reads.
      if (nowMs - readoutAtMs >= READOUT_EVERY_MS || nowMs < readoutAtMs) {
        readoutAtMs = nowMs;
        const pass = summarizeSamples(window(passMs));
        const trav = summarizeSamples(window(traversals));
        const frame = summarizeSamples(window(frameMs));
        const ms = (s: SampleSummary | null, d: number, pick: "p95" | "max") =>
          s === null ? "-" : s[pick].toFixed(d);
        readoutLine = [
          `anchors ${deferring === false ? "off" : "on"}: pass p95 ${ms(pass, 2, "p95")} max ${ms(pass, 2, "max")} ms, trav ${trav === null ? "-" : trav.mean.toFixed(2)}/pass, frame p95 ${ms(frame, 1, "p95")} ms (${String(kept)})`,
        ];
      }
      return readoutLine;
    },
    clear() {
      next = 0;
      kept = 0;
      seen = 0;
      lines = [];
      droppedLines = 0;
      readoutAtMs = -Infinity;
      readoutLine = [];
    },
  };
}

/**
 * The page's anchor log, fed by the framework for the page's life: its
 * pass observer and its log stream. Returns the log and the stop function
 * (for tests; the page never stops it).
 */
export function startAnchorDebugLog(): {
  readonly log: AnchorDebugLog;
  stop(): void;
} {
  const log = createAnchorDebugLog();
  const stopPasses = observeDeferredAnchorPasses((sample) => {
    log.pass(sample);
  });
  const stopLines = subscribeToLogs((entry) => {
    log.entry(entry);
  });
  return {
    log,
    stop() {
      stopPasses();
      stopLines();
    },
  };
}

function summaryText(s: SampleSummary | null, digits: number): string {
  if (s === null) return "-";
  return `p50 ${s.p50.toFixed(digits)} p95 ${s.p95.toFixed(digits)} max ${s.max.toFixed(digits)} (n ${String(s.count)})`;
}

function traversalText(s: SampleSummary | null): string {
  if (s === null) return "-";
  return `mean ${s.mean.toFixed(3)} max ${String(s.max)} (n ${String(s.count)})`;
}

/** Local wall-clock time `HH:MM:SS.mmm`, the console's timestamps. */
function clockOf(ms: number): string {
  if (!Number.isFinite(ms)) return "--:--:--.---";
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
