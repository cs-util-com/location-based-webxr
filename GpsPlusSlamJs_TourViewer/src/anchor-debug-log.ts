/**
 * The anchor section of a visitor's `?debug=1` Copy log: the recent
 * `[DeferredAnchors]` log lines (commits, window opened and closed, follow
 * start and end), and over the last passes the anchor pass time, the
 * traversals per pass and the frame time, each with its sample count,
 * kept apart for the deferral on and off (`anchors=ab` alternates them in
 * one session), plus the commits by kind and the frames each out-of-view
 * commit waited. The phone field test of the deferred anchors reads its
 * pass criteria from it: the section ends in a verdict, PASS or FAIL per
 * criterion, or "not measured" with what to do.
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

/** How a commit came about, as the pass observer names it. */
type CommitKind = DeferredAnchorPassSample["commits"][number]["kind"];

/**
 * Passes kept per deferral state for the summaries: about 60 s at 60
 * frames a second; in an `anchors=ab` session the last 2 minutes or so.
 */
const ANCHOR_LOG_PASSES = 3600;
/** `[DeferredAnchors]` lines kept (the oldest go first). */
const ANCHOR_LOG_LINES = 2000;
/** The readout recomputes its lines at most this often (ms). */
const READOUT_EVERY_MS = 1000;
const TAG = "DeferredAnchors";

/** The field test's limit on the anchor pass p95, deferral on (ms, inclusive). */
export const PASS_P95_LIMIT_MS = 0.5;
/** The field test's limit on the frame p95, deferral on minus off (ms, inclusive). */
export const FRAME_REGRESSION_LIMIT_MS = 1;
/**
 * Frames each half needs before the frame p95s are compared: 5 s at 60
 * frames a second, so one 15 s turn of `anchors=ab` is enough.
 */
export const MIN_FRAME_SAMPLES = 300;

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
  /** The `?debug=1` readout's lines (none before the first pass). */
  readout(nowMs: number): string[];
  /** Empty the buffers (after a copy or a download, with the travel log). */
  clear(): void;
}

/** The pass, traversal and frame-time rings of one deferral state. */
interface Rings {
  readonly passMs: Float64Array;
  readonly traversals: Float64Array;
  readonly frameMs: Float64Array;
  next: number;
  kept: number;
}

/** A criterion's result: true PASS, false FAIL, null not measured. */
type Verdict = boolean | null;

interface Summaries {
  readonly pass: SampleSummary | null;
  readonly trav: SampleSummary | null;
  readonly frame: SampleSummary | null;
}

/**
 * @param options.passes how many passes the summaries cover, per deferral state.
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
  const rings = (): Rings => ({
    passMs: new Float64Array(capacity),
    traversals: new Float64Array(capacity),
    frameMs: new Float64Array(capacity),
    next: 0,
    kept: 0,
  });
  const on = rings();
  const off = rings();
  let seen = 0;
  let lastDeferring: boolean | null = null;
  // Commits since the last clear, by kind in the order first seen.
  let commitKinds = new Map<CommitKind, number>();
  let commitCount = 0;
  let outCommits = 0;
  let outMostFrames = 0;
  let outMostQueued = 0;
  let outOverQueue = 0;
  let lines: string[] = [];
  let droppedLines = 0;
  let readoutAtMs = -Infinity;
  let readoutLines: string[] = [];

  const summaries = (r: Rings): Summaries => ({
    pass: summarizeSamples(r.passMs.subarray(0, r.kept)),
    trav: summarizeSamples(r.traversals.subarray(0, r.kept)),
    frame: summarizeSamples(r.frameMs.subarray(0, r.kept)),
  });

  const passVerdict = (s: Summaries): Verdict =>
    s.pass === null ? null : s.pass.p95 <= PASS_P95_LIMIT_MS;

  /** Deferral-on minus deferral-off frame p95, when both halves have enough frames. */
  const frameRegression = (
    onS: Summaries,
    offS: Summaries,
  ): { on: number; off: number; delta: number } | null => {
    if (
      onS.frame === null ||
      offS.frame === null ||
      onS.frame.count < MIN_FRAME_SAMPLES ||
      offS.frame.count < MIN_FRAME_SAMPLES
    ) {
      return null;
    }
    return {
      on: onS.frame.p95,
      off: offS.frame.p95,
      delta: onS.frame.p95 - offS.frame.p95,
    };
  };

  const queueVerdict = (): Verdict =>
    outCommits === 0 ? null : outOverQueue === 0;

  const deferralText = (): string => {
    if (on.kept > 0 && off.kept > 0) {
      return "deferral on and off in turns (anchors=ab)";
    }
    if (on.kept > 0) return "deferral on";
    if (off.kept > 0) return "deferral off (anchors=0)";
    return `deferral ${lastDeferring === null ? "-" : lastDeferring ? "on" : "off"}`;
  };

  return {
    pass(sample) {
      // A non-finite value is kept as NaN, so its column skips it alone.
      const finite = (v: number): number => (Number.isFinite(v) ? v : NaN);
      const r = sample.deferring ? on : off;
      r.passMs[r.next] = finite(sample.passMs);
      r.traversals[r.next] = finite(sample.counts.traversals);
      // The frame loop's first frame has no dt: no frame time.
      r.frameMs[r.next] = sample.dt > 0 ? finite(sample.dt * 1000) : NaN;
      r.next = (r.next + 1) % capacity;
      r.kept = Math.min(r.kept + 1, capacity);
      seen += 1;
      lastDeferring = sample.deferring;
      // The commits list is valid during this call only: count it now.
      for (const c of sample.commits) {
        commitCount += 1;
        commitKinds.set(c.kind, (commitKinds.get(c.kind) ?? 0) + 1);
        if (c.kind !== "out-of-view") continue;
        outCommits += 1;
        outMostFrames = Math.max(outMostFrames, c.outFrames);
        outMostQueued = Math.max(outMostQueued, c.queued);
        if (c.outFrames > c.queued) outOverQueue += 1;
      }
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
      const onS = summaries(on);
      const offS = summaries(off);
      const fr = frameRegression(onS, offS);
      const qv = queueVerdict();
      const kinds = [...commitKinds]
        .map(([kind, n]) => `${kind} ${String(n)}`)
        .join(", ");
      const out = [
        "--- anchors ---",
        deferralText(),
        `passes ${String(seen)} seen, last ${String(on.kept + off.kept)} summarized`,
        `pass ms ${summaryText(onS.pass, 3)}`,
        `traversals per pass ${traversalText(onS.trav)}`,
        `frame ms ${summaryText(onS.frame, 1)}`,
        ...(off.kept > 0
          ? [
              `deferral off: pass ms ${summaryText(offS.pass, 3)}, frame ms ${summaryText(offS.frame, 1)}`,
            ]
          : []),
        `commits ${String(commitCount)}${kinds === "" ? "" : `: ${kinds}`}`,
        ...(outCommits > 0
          ? [
              `out of view: most ${String(outMostFrames)} frames (queue up to ${String(outMostQueued)}), ${String(outOverQueue)} over their queue`,
            ]
          : []),
        "--- verdict ---",
        onS.pass === null
          ? "pass p95: not measured (no pass with the deferral on)"
          : `pass p95 ${onS.pass.p95.toFixed(3)} ms (limit ${String(PASS_P95_LIMIT_MS)}): ${verdictWord(onS.pass.p95 <= PASS_P95_LIMIT_MS)}`,
        fr === null
          ? `frame p95 regression: not measured, open with &anchors=ab (on n ${String(onS.frame?.count ?? 0)}, off n ${String(offS.frame?.count ?? 0)}, need ${String(MIN_FRAME_SAMPLES)} each)`
          : `frame p95 regression ${fr.delta.toFixed(1)} ms (on ${fr.on.toFixed(1)}, off ${fr.off.toFixed(1)}, limit ${String(FRAME_REGRESSION_LIMIT_MS)}): ${verdictWord(fr.delta <= FRAME_REGRESSION_LIMIT_MS)}`,
        qv === null
          ? "out-of-view commits within their queue: not measured (none yet)"
          : `out-of-view commits within their queue (${String(outCommits - outOverQueue)} of ${String(outCommits)}): ${verdictWord(qv)}`,
        `lines ${String(lines.length)}${droppedLines > 0 ? `, ${String(droppedLines)} older dropped` : ""}`,
        ...lines,
      ];
      return out.join("\n");
    },
    readout(nowMs) {
      if (on.kept + off.kept === 0) return [];
      // Sorting the rings is cheap but not free: once a second is enough
      // for lines a person reads.
      if (nowMs - readoutAtMs >= READOUT_EVERY_MS || nowMs < readoutAtMs) {
        readoutAtMs = nowMs;
        const onS = summaries(on);
        const offS = summaries(off);
        // The numbers of the deferral-on passes, or of the off ones when
        // the session has none (anchors=0).
        const shown = on.kept > 0 ? onS : offS;
        const label =
          on.kept > 0 && off.kept > 0 ? "ab" : on.kept > 0 ? "on" : "off";
        const ms = (s: SampleSummary | null, d: number, pick: "p95" | "max") =>
          s === null ? "-" : s[pick].toFixed(d);
        const fr = frameRegression(onS, offS);
        readoutLines = [
          `anchors ${label}: pass p95 ${ms(shown.pass, 2, "p95")} max ${ms(shown.pass, 2, "max")} ms, trav ${shown.trav === null ? "-" : shown.trav.mean.toFixed(2)}/pass, frame p95 ${ms(shown.frame, 1, "p95")} ms (${String(on.kept > 0 ? on.kept : off.kept)})`,
          `anchor test: pass ${shortWord(passVerdict(onS))}, frame ${shortWord(fr === null ? null : fr.delta <= FRAME_REGRESSION_LIMIT_MS)}, queue ${shortWord(queueVerdict())}`,
        ];
      }
      return readoutLines;
    },
    clear() {
      for (const r of [on, off]) {
        r.next = 0;
        r.kept = 0;
      }
      seen = 0;
      lastDeferring = null;
      commitKinds = new Map();
      commitCount = 0;
      outCommits = 0;
      outMostFrames = 0;
      outMostQueued = 0;
      outOverQueue = 0;
      lines = [];
      droppedLines = 0;
      readoutAtMs = -Infinity;
      readoutLines = [];
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

function verdictWord(v: boolean): string {
  return v ? "PASS" : "FAIL";
}

function shortWord(v: Verdict): string {
  return v === null ? "-" : verdictWord(v);
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
