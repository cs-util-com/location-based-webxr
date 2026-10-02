/**
 * What a real walk's GPS error looks like, in the two numbers the moved-code
 * measurements' synthetic model used (Tour Viewer authoring plan
 * 2026-09-28-0953 §3.6, decision D20, the recalibration on real recordings):
 * a first-order Gauss-Markov error per axis, stationary sigma and time
 * constant tau. Plus the compass comparison's one geometric kernel: which
 * bearing an alignment gives the AR frame's north axis.
 *
 * MEASUREMENT ONLY. Nothing in the viewer or the authoring flow reads this;
 * the opt-in recording sweep (`code-displacement.recordings.test.ts`) does.
 *
 * THE FIT. Residuals are demeaned per series (the model is zero-mean; a
 * constant per-session bias is a separate quantity), then:
 * - sigma: the RMS of the demeaned residuals per axis, both axes pooled -
 *   the M5a model's per-axis sigma (its horizontal RMS is about 1.4 sigma);
 * - the autocorrelation rho(lag) over every pair of samples of one series
 *   at most `maxLagS` apart, binned by `binS`, both axes pooled; for an
 *   irregular fix stream this needs no resampling;
 * - tau: the first lag at which rho falls below 1/e, interpolated linearly
 *   between bins (for a Gauss-Markov process rho = exp(-lag / tau), so that
 *   lag is tau). Null, with `censored`, when rho never falls that far within
 *   `maxLagS`: the time constant is then longer than the window can show.
 *
 * Several series are pooled into one fit (each demeaned on its own), so a
 * corpus fit weights every PAIR equally, not every session.
 *
 * Inputs are external data (a replayed recording): non-finite samples are
 * skipped, never repaired; a series must be in time order (the pair window
 * relies on it) and an out-of-order sample throws.
 *
 * @see gps-noise-fit.ts.md
 */

/** One residual of a device fix against a reference path: GPS minus the
 *  reference, metres north and east, at the fix's own time. */
export interface ResidualSample {
  readonly tMs: number;
  readonly n: number;
  readonly e: number;
}

export interface GaussMarkovFit {
  /** Per-axis stationary sigma (m), both axes pooled. */
  readonly sigmaM: number;
  /** The 1/e lag (s), or null when rho stays above 1/e up to `maxLagS`. */
  readonly tauS: number | null;
  /** True when `tauS` is null because the window was too short. */
  readonly censored: boolean;
  /** rho per lag bin (bin k covers lags around k * binS); NaN for an empty
   *  bin. Bin 0 holds the zero-lag pairs (and any closer than half a bin),
   *  so it is 1 when fixes are at least half a bin apart. */
  readonly rho: readonly number[];
  /** Samples used (finite), over all series. */
  readonly samples: number;
}

export interface GaussMarkovFitOptions {
  /** Longest lag considered (s). Default 300. */
  readonly maxLagS?: number;
  /** Lag bin width (s). Default 1 (a 1 Hz fix stream). */
  readonly binS?: number;
}

const INV_E = Math.exp(-1);

function finiteSamples(series: readonly ResidualSample[]): ResidualSample[] {
  const out: ResidualSample[] = [];
  for (const s of series) {
    if (
      !Number.isFinite(s.tMs) ||
      !Number.isFinite(s.n) ||
      !Number.isFinite(s.e)
    ) {
      continue;
    }
    const last = out[out.length - 1];
    if (last !== undefined && s.tMs < last.tMs) {
      throw new RangeError(
        `residual series must be in time order (${String(s.tMs)} after ${String(last.tMs)})`,
      );
    }
    out.push(s);
  }
  return out;
}

function positiveOption(name: string, value: number): number {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(
      `${name} must be a positive number, got ${String(value)}`,
    );
  }
  return value;
}

/** The lag (s) where rho first falls below 1/e, interpolated between the
 *  last bin above and the first below; null when it never does. */
function oneOverELag(rho: readonly number[], binS: number): number | null {
  let prevK = 0;
  for (let k = 1; k < rho.length; k += 1) {
    const r = rho[k]!;
    if (Number.isNaN(r)) continue;
    if (r < INV_E) {
      const r0 = rho[prevK]!;
      return (prevK + ((r0 - INV_E) / (r0 - r)) * (k - prevK)) * binS;
    }
    prevK = k;
  }
  return null;
}

/** Running sums of lagged products over every pair at most `bins - 1`
 *  bins apart, of one demeaned series. */
function accumulatePairs(
  series: readonly ResidualSample[],
  acc: {
    sum: Float64Array;
    count: Float64Array;
    sumSq: number;
    samples: number;
  },
  maxLagS: number,
  binS: number,
): void {
  let mn = 0;
  let me = 0;
  for (const s of series) {
    mn += s.n;
    me += s.e;
  }
  mn /= series.length;
  me /= series.length;
  const n = series.map((s) => s.n - mn);
  const e = series.map((s) => s.e - me);
  for (let i = 0; i < series.length; i += 1) {
    acc.sumSq += n[i]! * n[i]! + e[i]! * e[i]!;
    acc.samples += 1;
    for (let j = i; j < series.length; j += 1) {
      const lagS = (series[j]!.tMs - series[i]!.tMs) / 1000;
      if (lagS > maxLagS) break;
      const k = Math.round(lagS / binS);
      acc.sum[k]! += n[i]! * n[j]! + e[i]! * e[j]!;
      acc.count[k]! += 2;
    }
  }
}

/**
 * Fit a first-order Gauss-Markov model to one or more residual series.
 *
 * @returns null when fewer than two finite samples remain or their variance
 *   is zero (no error to describe).
 * @throws RangeError for a non-positive or non-finite `maxLagS` / `binS`,
 *   and for a series out of time order.
 */
export function fitGaussMarkov(
  seriesList: readonly (readonly ResidualSample[])[],
  options: GaussMarkovFitOptions = {},
): GaussMarkovFit | null {
  const maxLagS = positiveOption("maxLagS", options.maxLagS ?? 300);
  const binS = positiveOption("binS", options.binS ?? 1);
  const bins = Math.floor(maxLagS / binS) + 1;
  const acc = {
    sum: new Float64Array(bins),
    count: new Float64Array(bins),
    sumSq: 0,
    samples: 0,
  };
  for (const raw of seriesList) {
    const series = finiteSamples(raw);
    if (series.length > 0) accumulatePairs(series, acc, maxLagS, binS);
  }
  if (acc.samples < 2 || !(acc.sumSq > 0)) return null;
  const variance = acc.sumSq / (2 * acc.samples);
  const rho = Array.from(acc.sum, (s, k) =>
    acc.count[k]! > 0 ? s / acc.count[k]! / variance : Number.NaN,
  );
  const tauS = oneOverELag(rho, binS);
  return {
    sigmaM: Math.sqrt(variance),
    tauS,
    censored: tauS === null,
    rho,
    samples: acc.samples,
  };
}

/**
 * The bearing (degrees clockwise from north, [0, 360)) that an alignment
 * (odometry-NUE to GPS-world NUE, column-major 4x4) gives the odometry's
 * north axis - which is the AR frame's -Z, the axis the core's
 * `arNorthBearingDeg` reads from the compass. The two are therefore
 * directly comparable (the sweep's compass error is their difference; the
 * convention is pinned by a test against the core's kernel).
 *
 * @returns null for anything but 16 finite numbers, and when the axis maps
 *   to (near) vertical.
 */
export function alignmentNorthBearingDeg(
  alignment: ArrayLike<number>,
): number | null {
  if (alignment.length !== 16) return null;
  const n = alignment[0];
  const e = alignment[2];
  for (let i = 0; i < 16; i += 1) {
    if (!Number.isFinite(alignment[i])) return null;
  }
  if (n === undefined || e === undefined || Math.hypot(n, e) < 1e-6) {
    return null;
  }
  const deg = (Math.atan2(e, n) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}
