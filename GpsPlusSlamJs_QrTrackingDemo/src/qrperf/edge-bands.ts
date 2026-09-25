/**
 * The `?qrperf` code-size bands (QR near-frontal pose plan §34 R2): the
 * code's size on screen (its mean edge length, px) split into small /
 * medium / large, and percentiles of a signal per band - so a field test
 * shows how each pixel signal grows with the code's size before any
 * threshold becomes size-relative. See edge-bands.ts.md.
 */

import { nearestRankPercentile } from "./pipeline-timings.js";

export type EdgeBand = "small" | "medium" | "large";

/** Band limits, px: small below the first, large from the second. */
const EDGE_BAND_LIMITS_PX = [150, 300] as const;

const BANDS: readonly EdgeBand[] = ["small", "medium", "large"];

export interface BandPercentiles {
  n: number;
  p50: number | null;
  p95: number | null;
}

export type Banded<T> = Record<EdgeBand, T>;

/** The band of a size on screen, or null without a finite size. */
export function edgeBand(edgePx: number | null): EdgeBand | null {
  if (edgePx === null || !Number.isFinite(edgePx)) return null;
  if (edgePx < EDGE_BAND_LIMITS_PX[0]) return "small";
  return edgePx < EDGE_BAND_LIMITS_PX[1] ? "medium" : "large";
}

/** One value per band key. */
export function perBand<T>(make: () => T): Banded<T> {
  return { small: make(), medium: make(), large: make() };
}

/**
 * Percentiles of a signal per band; `window` keeps only the last values of
 * each band (like the raw pose series), unbounded when omitted.
 */
export function createBandedPercentiles(window?: number): {
  add(edgePx: number | null, value: number | null): void;
  summary(): Banded<BandPercentiles>;
} {
  const values = perBand<number[]>(() => []);
  return {
    add(edgePx, value) {
      const band = edgeBand(edgePx);
      if (!band || value === null || !Number.isFinite(value)) return;
      const series = values[band];
      series.push(value);
      if (window !== undefined && series.length > window) series.shift();
    },
    summary() {
      const out = perBand<BandPercentiles>(() => ({
        n: 0,
        p50: null,
        p95: null,
      }));
      for (const band of BANDS) {
        const v = values[band];
        if (v.length === 0) continue;
        out[band] = {
          n: v.length,
          p50: nearestRankPercentile(v, 0.5),
          p95: nearestRankPercentile(v, 0.95),
        };
      }
      return out;
    },
  };
}

const f = (v: number | null): string => (v === null ? "-" : v.toFixed(1));

/** One report fragment: `small p50/p95 (n) | medium ... | large ...`. */
export function bandsLine(b: Banded<BandPercentiles>): string {
  return BANDS.map(
    (band) => `${band} ${f(b[band].p50)}/${f(b[band].p95)} (n ${b[band].n})`,
  ).join(" | ");
}
