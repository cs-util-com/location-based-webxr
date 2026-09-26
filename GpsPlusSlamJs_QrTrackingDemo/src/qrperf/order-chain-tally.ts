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
  unsureRuns: RunCounts;
  /**
   * Runs of consecutive NATIVE detections (plan §55 #8: the fused window
   * ignores them once a code's order is known, which is right while they
   * come in short runs).
   */
  nativeRuns: RunCounts;
}

interface RunCounts {
  r1: number;
  r2to4: number;
  r5to8: number;
  r9plus: number;
}

type RunKey = keyof RunCounts;

function runKey(n: number): RunKey {
  if (n >= 9) return "r9plus";
  if (n >= 5) return "r5to8";
  return n >= 2 ? "r2to4" : "r1";
}

/** Counts runs of consecutive detections that match, as they end. */
function createRunCounter() {
  const runs: RunCounts = { r1: 0, r2to4: 0, r5to8: 0, r9plus: 0 };
  let run = 0;
  return {
    add(inRun: boolean) {
      if (inRun) {
        run += 1;
        return;
      }
      if (run > 0) runs[runKey(run)] += 1;
      run = 0;
    },
    /** The counts, with an open run as it stands. */
    counts(): RunCounts {
      const out = { ...runs };
      if (run > 0) out[runKey(run)] += 1;
      return out;
    },
  };
}

export function createOrderChainTally(): {
  /** One detection (a hit); detections without an order source are ignored. */
  add(detection: Pick<QrDetection, "orderSource" | "orderAudit">): void;
  summary(): OrderChainSummary;
} {
  const audit = { agree: 0, disagree: 0, reject: 0 };
  const unsure = createRunCounter();
  const native = createRunCounter();
  return {
    add(detection) {
      if (detection.orderAudit) audit[detection.orderAudit] += 1;
      if (!detection.orderSource) return;
      unsure.add(detection.orderSource !== "finder");
      native.add(detection.orderSource === "native");
    },
    summary() {
      return {
        audit: { ...audit },
        unsureRuns: unsure.counts(),
        nativeRuns: native.counts(),
      };
    },
  };
}
