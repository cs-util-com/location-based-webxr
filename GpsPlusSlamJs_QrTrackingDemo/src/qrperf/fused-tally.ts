/**
 * The `?qrperf` tally of the demo's fused QR pose (QR near-frontal pose plan
 * M3b b5): per lock, whether the fused pose was stable, which rotation it
 * carried (joint or the averaged fallback), how well the views fit, and how
 * far the joint rotation sat from today's averaged one. See fused-tally.ts.md.
 */

import type { QrFusedPose } from "gps-plus-slam-app-framework/ar/qr";
import { nearestRankPercentile } from "./pipeline-timings.js";

export interface FusedTallySummary {
  locks: number;
  stable: number;
  joint: number;
  averaged: number;
  /** Median / 95th percentile of the median per-view fit, px (finite only). */
  fitP50Px: number | null;
  fitP95Px: number | null;
  /** Median / 95th percentile angle between joint and averaged, deg. */
  deltaP50Deg: number | null;
  deltaP95Deg: number | null;
}

export function createFusedTally(): {
  add(result: QrFusedPose): void;
  summary(): FusedTallySummary;
} {
  const counts = { locks: 0, stable: 0, joint: 0, averaged: 0 };
  const fits: number[] = [];
  const deltas: number[] = [];
  const pct = (xs: number[], p: number) =>
    xs.length ? nearestRankPercentile(xs, p) : null;
  return {
    add(result) {
      counts.locks += 1;
      if (result.status === "stable") counts.stable += 1;
      if (result.method === "joint") counts.joint += 1;
      if (result.method === "averaged") counts.averaged += 1;
      if (Number.isFinite(result.fitPx)) fits.push(result.fitPx);
      if (Number.isFinite(result.averagedRotationDeltaDeg))
        deltas.push(result.averagedRotationDeltaDeg);
    },
    summary() {
      return {
        ...counts,
        fitP50Px: pct(fits, 0.5),
        fitP95Px: pct(fits, 0.95),
        deltaP50Deg: pct(deltas, 0.5),
        deltaP95Deg: pct(deltas, 0.95),
      };
    },
  };
}

/** The report line, e.g. `fused: 40 locks | stable 30 | joint 38 / averaged 2 | fit p50/p95 0.6/1.1 px | vs averaged p50/p95 2.1/6.0 deg`. */
export function fusedLine(s: FusedTallySummary): string {
  const f = (v: number | null, d = 1) => (v === null ? "-" : v.toFixed(d));
  return `fused: ${s.locks} locks | stable ${s.stable} | joint ${s.joint} / averaged ${s.averaged} | fit p50/p95 ${f(s.fitP50Px)}/${f(s.fitP95Px)} px | vs averaged p50/p95 ${f(s.deltaP50Deg)}/${f(s.deltaP95Deg)} deg`;
}
