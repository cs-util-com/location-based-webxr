/**
 * The `?qrperf` tally of the chained corner order (QR near-frontal pose plan
 * §42 S4): on each finder frame, what the live chain would have picked
 * (agree / disagree / reject - the chain's error rate on the phone), and
 * how long the runs of non-finder frames are (what the chain has to carry).
 * See order-chain-tally.ts.md.
 */

import type { QrDetection } from "gps-plus-slam-app-framework/ar/qr";

export interface OrderChainSummary {
  audit: { agree: number; disagree: number; reject: number };
  /** Runs of consecutive memory / native detections between finder ones. */
  unsureRuns: { r1: number; r2to4: number; r5to8: number; r9plus: number };
}

type RunKey = keyof OrderChainSummary["unsureRuns"];

function runKey(n: number): RunKey {
  if (n >= 9) return "r9plus";
  if (n >= 5) return "r5to8";
  return n >= 2 ? "r2to4" : "r1";
}

export function createOrderChainTally(): {
  /** One detection (a hit); detections without an order source are ignored. */
  add(detection: Pick<QrDetection, "orderSource" | "orderAudit">): void;
  summary(): OrderChainSummary;
} {
  const audit = { agree: 0, disagree: 0, reject: 0 };
  const runs = { r1: 0, r2to4: 0, r5to8: 0, r9plus: 0 };
  let run = 0;
  return {
    add(detection) {
      if (detection.orderAudit) audit[detection.orderAudit] += 1;
      if (!detection.orderSource) return;
      if (detection.orderSource !== "finder") {
        run += 1;
        return;
      }
      if (run > 0) runs[runKey(run)] += 1;
      run = 0;
    },
    summary() {
      const unsureRuns = { ...runs };
      // An open run counts as it stands.
      if (run > 0) unsureRuns[runKey(run)] += 1;
      return { audit: { ...audit }, unsureRuns };
    },
  };
}
