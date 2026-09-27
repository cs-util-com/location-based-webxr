/**
 * The `?qrperf` size section (QR size consensus plan 2026-09-27-0350, §7-§8,
 * S2): per run, the code's size from parallax beside its size from depth,
 * and a flag when they part by a 2x-class margin. Log only - nothing acts on
 * it yet. See size-tally.ts.md.
 */

import type { QrParallaxSize } from "gps-plus-slam-app-framework/ar/qr";
import { nearestRankPercentile } from "./pipeline-timings.js";
import type { SizeState } from "./motion-tally.js";

/** Sizes further apart than this read as a conflict (plan §7: 2x-class). */
const CONFLICT_RATIO = 0.25;

export interface SizeSample {
  /** The parallax estimate over the code's recent views, or null if refused. */
  parallax: QrParallaxSize | null;
  /** Whether the motion detector read the code as turning (then skipped). */
  turning: boolean;
  /** The depth size state, when the demo has one. */
  depth?: SizeState;
}

export interface SizeTallySummary {
  parallax: {
    /** Windows whose size entered the numbers. */
    windows: number;
    /** Windows the estimate refused (no scale). */
    refused: number;
    /** Windows skipped because the code was turning (parallax needs it still). */
    skippedTurning: number;
    p10Cm: number | null;
    p50Cm: number | null;
    p90Cm: number | null;
    baselineP50Cm: number | null;
  };
  depth: {
    status: string | null;
    latestCm: number | null;
    /** The range the depth size covered while it read `estimated`. */
    estimatedMinCm: number | null;
    estimatedMaxCm: number | null;
  };
  /** Parallax median / latest estimated depth size, or null without both. */
  ratio: number | null;
  /** The larger of the two sizes exceeds the smaller by more than 25 %. */
  conflict: boolean;
}

const pct = (xs: readonly number[], p: number): number | null =>
  xs.length ? nearestRankPercentile(xs, p) : null;

export function createSizeTally(): {
  add(sample: SizeSample): void;
  summary(): SizeTallySummary;
} {
  const sizesCm: number[] = [];
  const baselinesCm: number[] = [];
  let refused = 0;
  let skippedTurning = 0;
  let depth: SizeState | null = null;
  let estMin: number | null = null;
  let estMax: number | null = null;

  function addDepth(d: SizeState): void {
    depth = d;
    if (d.status !== "estimated" || d.estimateM === null) return;
    const cm = d.estimateM * 100;
    estMin = estMin === null ? cm : Math.min(estMin, cm);
    estMax = estMax === null ? cm : Math.max(estMax, cm);
  }

  return {
    add(sample) {
      if (sample.depth) addDepth(sample.depth);
      if (sample.turning) skippedTurning += 1;
      else if (sample.parallax === null) refused += 1;
      else {
        sizesCm.push(sample.parallax.sizeM * 100);
        baselinesCm.push(sample.parallax.lateralBaselineM * 100);
      }
    },
    summary() {
      const p50 = pct(sizesCm, 0.5);
      const d: SizeState | null = depth;
      const latestCm = d?.estimateM == null ? null : d.estimateM * 100;
      const ratio =
        p50 !== null && d?.status === "estimated" && latestCm
          ? p50 / latestCm
          : null;
      return {
        parallax: {
          windows: sizesCm.length,
          refused,
          skippedTurning,
          p10Cm: pct(sizesCm, 0.1),
          p50Cm: p50,
          p90Cm: pct(sizesCm, 0.9),
          baselineP50Cm: pct(baselinesCm, 0.5),
        },
        depth: {
          status: d?.status ?? null,
          latestCm,
          estimatedMinCm: estMin,
          estimatedMaxCm: estMax,
        },
        ratio,
        // Symmetric: the larger over the smaller, whichever source is larger.
        conflict:
          ratio !== null && Math.max(ratio, 1 / ratio) > 1 + CONFLICT_RATIO,
      };
    },
  };
}

const f = (v: number | null, d = 1): string =>
  v === null ? "-" : v.toFixed(d);

/** The report line: parallax, depth, their ratio, and the conflict flag. */
export function sizeLines(s: SizeTallySummary): string[] {
  const p = s.parallax;
  const parallax =
    p.p50Cm === null
      ? "parallax -"
      : `parallax p50 ${f(p.p50Cm)} cm [${f(p.p10Cm)}, ${f(p.p90Cm)}]`;
  const depth =
    s.depth.latestCm === null
      ? "depth -"
      : `depth ${f(s.depth.latestCm)} cm ${s.depth.status ?? ""} (range ${f(s.depth.estimatedMinCm)}-${f(s.depth.estimatedMaxCm)})`;
  return [
    `size: ${parallax} (${p.windows} windows, baseline p50 ${f(p.baselineP50Cm)} cm; ${p.refused} refused, ${p.skippedTurning} while turning) | ${depth} | ratio ${f(s.ratio, 2)}${s.conflict ? " | CONFLICT" : ""}`,
  ];
}
