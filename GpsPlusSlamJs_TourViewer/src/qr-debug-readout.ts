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

/** Characters of the decoded text a line shows: the end carries the `n` token. */
const LABEL_CHARS = 12;

/** A short label for a decoded text (the full launch URL does not fit a line). */
export function codeLabel(text: string): string {
  return text.length <= LABEL_CHARS ? text : `…${text.slice(-LABEL_CHARS)}`;
}

/** One code's counts on one line. */
export function fusedCountsLine(label: string, c: FusedPoseCounts): string {
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
 * evaluates on every lock (~8/s while a code is in view), so 2 s without
 * one means the code left the view.
 */
export const HINT_STALE_MS = 2000;

/**
 * The visitor's line while a code is read but has not voted, or null.
 * Only while the controller tracks and the last evaluation is recent: the
 * hint describes the code in view, never one seen a while ago.
 */
export function visitorFusedHint(input: {
  last: LastEvaluation | null;
  status: QrTrackingStatus | null;
  nowMs: number;
}): string | null {
  const { last } = input;
  if (last === null || input.status !== "tracking") return null;
  if (input.nowMs - last.atMs > HINT_STALE_MS) return null;
  // Stable yet no vote: the votes wait for the session's GPS zero
  // (`canAcceptVotes`), not for the code (plan §67 #1).
  if (last.result.status === "stable") {
    return "Code measured - waiting for the first GPS fix.";
  }
  return `Measuring the code: ${waitingFor(last.result.notStableReason)}`;
}
