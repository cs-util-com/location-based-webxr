/**
 * What the TourViewer says about a code's fused pose (QR near-frontal pose
 * plan §66-§67): the `?debug=1` readout - per code, how often it was
 * stable and why not - and the visitor's hint while a code is read but has
 * not voted. See qr-debug-readout.ts.md.
 */

import {
  createFusedPoseTally,
  type FusedPoseCounts,
  type FusedPoseTally,
  type QrFusedPose,
} from "gps-plus-slam-app-framework/ar/qr";
import type { QrTrackingStatus } from "gps-plus-slam-app-framework/ar/qr/qr-tracking-controller";
import { waitingFor } from "./qr-author-mode.js";

/** Per decoded text, the lock counts of one pipeline's fused pose. */
export type FusedTallies = Map<string, FusedPoseTally>;

/** One new evaluation of a code, as the viewer last saw it. */
export interface LastEvaluation {
  text: string;
  result: QrFusedPose;
  /** When it was evaluated, on the render's clock (ms). */
  atMs: number;
}

/** Count one new evaluation of `text`. */
export function tallyEvaluation(
  tallies: FusedTallies,
  text: string,
  result: QrFusedPose,
): void {
  let tally = tallies.get(text);
  if (tally === undefined) {
    tally = createFusedPoseTally();
    tallies.set(text, tally);
  }
  tally.add(result);
}

/** Characters of the decoded text a line shows: the end carries the `n`
 *  token of codes 2 and up (code 1 has none; its tail is its blob). */
const LABEL_CHARS = 12;

/** A short label for a decoded text (the full launch URL does not fit a line). */
export function codeLabel(text: string): string {
  return text.length <= LABEL_CHARS ? text : `…${text.slice(-LABEL_CHARS)}`;
}

/** One code's counts on one line. */
function fusedCountsLine(label: string, c: FusedPoseCounts): string {
  const n = c.notStable;
  return (
    `${label}: locks ${String(c.locks)}, stable ${String(c.stable)}` +
    ` | views ${String(n.views)} (empty ${String(c.empty)}), fit ${String(n.fit)},` +
    ` fallback ${String(n.fallback)}, motion ${String(n.motion)}, order ${String(n.order)}` +
    ` | re-reads ${String(c.reReads)}, natives ignored ${String(c.nativeIgnoredLocks)}`
  );
}

/** The `?debug=1` block: the controller's state, then one line per code. */
export function debugReadoutLines(input: {
  status: QrTrackingStatus | null;
  unknownCode: string | null;
  unusableCode: string | null;
  tallies: FusedTallies | null;
}): string[] {
  let head = `qr: ${input.status ?? "off"}`;
  if (input.unknownCode !== null) head += ` | no level: ${input.unknownCode}`;
  if (input.unusableCode !== null) head += ` | no size: ${input.unusableCode}`;
  const lines = [head];
  for (const [text, tally] of input.tallies ?? []) {
    lines.push(fusedCountsLine(codeLabel(text), tally.summary()));
  }
  if (lines.length === 1) lines.push("no code evaluated yet");
  return lines;
}

/**
 * How long the visitor's hint outlives its evaluation (ms). The viewer
 * evaluates on each lock; on the phone that was 1-2 per second (r731-r736
 * field tests: 3.6-3.8 hits/s of ~7.5 detects/s, fewer locks), with runs
 * of misses between. 2 s bridges a normal run of misses and still drops
 * the hint soon after the code leaves the view (milestone review of b4c
 * #1, #4). Much shorter (0.5-1 s) would flicker at that cadence.
 */
export const HINT_STALE_MS = 2000;

/** The statuses under which a recent evaluation still describes the code
 *  in view: a single missed detection turns `tracking` into `scanning`
 *  until three hits in a row, so gating on `tracking` alone flickered
 *  (milestone review of b4c #1). The staleness window decides the rest. */
const HINT_STATUSES: ReadonlySet<QrTrackingStatus> = new Set([
  "tracking",
  "scanning",
]);

/** The visitor's wording for "too few views": the intro's (plan §67 #4).
 *  A wall poster cannot be walked around; views need not span angles. */
const KEEP_IN_VIEW = "keep it in view while you move slowly.";

/**
 * The visitor's line while a code is read but has not voted, or null.
 * Only while the controller tracks or briefly lost it, and while the last
 * evaluation is recent: the hint describes the code in view, never one
 * seen a while ago.
 *
 * Assumes ONE code in view (PR #508 review): with two, it describes
 * whichever was evaluated last, and can alternate between them. The
 * viewer's own "code that matters" (`viewerLockedText`) is set only by the
 * first VOTE, when this hint is no longer shown, so there is nothing
 * better to key on before it; `last.text` is kept for the readout and the
 * tests.
 */
export function visitorFusedHint(input: {
  last: LastEvaluation | null;
  status: QrTrackingStatus | null;
  nowMs: number;
}): string | null {
  const { last, status } = input;
  if (last === null || status === null || !HINT_STATUSES.has(status)) {
    return null;
  }
  if (input.nowMs - last.atMs > HINT_STALE_MS) return null;
  // Stable yet no vote: the votes wait for the session's GPS zero
  // (`canAcceptVotes`), not for the code (plan §67 #1).
  if (last.result.status === "stable") {
    return "Code measured - waiting for the first GPS fix.";
  }
  const reason = last.result.notStableReason;
  // `views` also covers an empty (unknown) result.
  return `Measuring the code: ${reason === "views" || reason === null ? KEEP_IN_VIEW : waitingFor(reason)}`;
}
