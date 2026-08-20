/**
 * Image-quality metrics + the drop/retry verdict policy for the image-content
 * capture gate (blur + blackness), the increment layered ON TOP of the motion
 * gate (`capture-motion-gate.ts`).
 *
 * Everything here is **pure and deterministic** — plain typed-array math plus a
 * tiny rolling-history class. There is **no DOM and no Web Worker** in this
 * module: it is fully unit-testable with synthetic buffers, and the recorder's
 * `image-quality.worker.ts` is a thin shell that decodes a frame to pixels and
 * calls into these functions. Keeping the verdict/history policy here (rather
 * than inside the worker, as the original plan §8 sketched) honours the project
 * rule that no untested logic ships: the worker is the device layer and is not
 * unit-built, so the median/threshold decision must live where tests can pin it.
 *
 * Metrics:
 *  - {@link sharpnessScore} — variance of the Laplacian over a grayscale buffer
 *    (the standard Pech-Pacheco focus measure). Scene-dependent in absolute
 *    terms, so the gate compares it RELATIVE to a rolling median (§5).
 *  - {@link meanLuminance} — mean Rec. 601 luma of an RGBA buffer. Near-zero ⇒
 *    black/empty frame; an absolute cutoff is safe because "black is black"
 *    regardless of scene texture (§5).
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-06-24-1057-image-quality-gate-plan.md
 * @see ./capture-motion-gate.ts — the motion gate this builds on (same shape:
 *   a shared config type + a small stateful window + a pure decision).
 */

import { lowerMedian } from '../utils/median.js';
import { validateOptionFields } from '../utils/validate-option-fields.js';

/**
 * Selectable sharpness metrics for the gate's blur check. Both are pure
 * grayscale scorers with identical defensive contracts; the gate's RELATIVE
 * rule (`score < k · median(recent)`) is metric-agnostic, so the same
 * `blurRelativeThreshold` slider drives either. Benchmarked against the
 * hand-labeled recording 2026-07-11 (variance-of-Laplacian best at "clearly
 * blurry vs rest", the energy ratio best at "sharp vs degraded") — see
 * GpsPlusSlamJs_Docs/docs/2026-07-12-0823-blur-metric-toggle-plan.md.
 */
export type BlurMetricId =
  | 'variance-of-laplacian'
  | 'high-frequency-energy-ratio';

/** All valid {@link BlurMetricId} values, the default (VoL) first — for
 *  consumer-side validation of persisted configs. */
export const BLUR_METRIC_IDS: readonly BlurMetricId[] = [
  'variance-of-laplacian',
  'high-frequency-energy-ratio',
];

/**
 * User-/consumer-facing configuration for the image-quality gate. Shared by both
 * config shapes that carry it — `ImageCaptureConfig` (what `ImageCaptureManager`
 * consumes) and `ImageCaptureOptions` (the persisted recorder options) — so the
 * one definition cannot drift between them, exactly as `MotionFilterConfig` is
 * shared (see `capture-motion-gate.ts` and the motion-gate follow-up §3).
 */
export interface QualityFilterConfig {
  /** Master switch for the image-quality gate. Default `false` (see below). */
  enabled: boolean;
  /**
   * Blur cutoff as a fraction `k` of the recent sharpness median: a frame is
   * judged blurry when its sharpness `< k · median(recent)`. ~0.5 is a sensible
   * start. Relative (not absolute) because variance-of-Laplacian is
   * scene-dependent — a correctly-focused blank wall scores low (§5).
   */
  blurRelativeThreshold: number;
  /**
   * Absolute black cutoff on a 0–255 luma scale: a frame whose mean luminance is
   * below this is judged black/empty and dropped. Absolute is safe because black
   * is black regardless of scene (§5). Supersedes the byte-size
   * `MIN_VALID_IMAGE_BYTES` heuristic for correctness (kept as a cheap
   * pre-filter).
   */
  minMeanLuminance: number;
  /**
   * Never-good safety fallback: once a due capture has been retried for this many
   * ms without an acceptable frame, the next frame is saved regardless of the
   * image verdict, so a recording interval is never silently lost (mirrors the
   * motion gate's `maxWaitMs`). A sensible value is ~2× the capture interval.
   */
  maxWaitMs: number;
  /**
   * Which sharpness metric the blur check scores frames with. **Optional**
   * for backward compatibility with configs persisted before the toggle
   * existed: `undefined` means `'variance-of-laplacian'` (the original
   * behavior) — resolve via {@link blurMetricScorer}, never by reading this
   * field directly.
   */
  blurMetric?: BlurMetricId;
}

/**
 * Default image-quality configuration. **Enabled at k = 0.8 since 2026-08-20
 * (owner decision).** The thresholds are no longer placeholders: they come from
 * a benchmark against 156 hand-labelled frames (51 blurry / 63 blurry-a-bit /
 * 42 sharp) from `2026-07-11_12-44-13utc`, replayed through this gate across
 * k = 0.10–1.20 — see
 * `gps-plus-slam/GpsPlusSlamJs_Investigation/docs/2026-07-12-0059-image-blur-benchmark-findings-and-followups.md`.
 *
 * What that benchmark measured, and what it did not:
 *
 * - **k = 0.8 rejects ~30 % of frames at ~0.98 precision** against the
 *   "degraded vs sharp" boundary — it almost never rejects a sharp frame — and
 *   catches 59 % of the clearly-blurry ones. k = 0.5 (the previous default) was
 *   safer still (precision 1.0) but caught only ~20 %, which the findings doc
 *   describes as fixing "little on its own". Above k ≈ 0.85 precision decays
 *   fast, which is why the gate is not pushed further.
 * - **The retry BENEFIT is unmeasured.** A replay only sees frames that were
 *   captured, so "30 % rejected" is known and "the replacement was sharper" is
 *   not. `maxWaitMs` (4000 ms, 2× the default 2000 ms image interval) bounds
 *   the cost, and the never-good fallback still saves a frame rather than
 *   starving the interval.
 * - **The labelled scene is INDOOR**, and this framework's domain is outdoors.
 *   Promotion was previously blocked on a second labelled recording; the owner
 *   accepted single-scene tuning on 2026-08-20 rather than keep a measured,
 *   near-costless improvement unused. If outdoor frames score systematically
 *   lower, the reject rate rises above 30 % and the practical symptom is a
 *   reduced capture rate — adjustable from the recorder's existing sliders.
 */
export const DEFAULT_QUALITY_FILTER: QualityFilterConfig = {
  enabled: true,
  blurRelativeThreshold: 0.8,
  minMeanLuminance: 10,
  maxWaitMs: 4000,
  blurMetric: 'variance-of-laplacian',
};

/**
 * Valid ranges for the {@link QualityFilterConfig} thresholds — bounds derived
 * from what each number MEANS to this gate, so they live with the gate rather
 * than with whichever app persists a config for it.
 *
 * `blurRelativeThreshold` (`k` in `sharpness < k·median`) is clamped to
 * 0.05–0.95: it is a fraction of the recent sharpness median, so it must sit
 * strictly inside (0, 1) — at ~0 the blur check never rejects, near 1 it
 * rejects almost everything. `minMeanLuminance` (the absolute black cutoff on a
 * 0–255 luma scale) is clamped to 0–128: 0 disables the black check, and a
 * cutoff above mid-grey would reject normally-lit frames. `maxWaitMs` mirrors
 * the motion gate's range (0.5–20 s) so the never-good fallback can always
 * fire. `step` is the granularity a settings slider should use for the value.
 */
export const QUALITY_FILTER_CONSTRAINTS = {
  blurRelativeThreshold: { min: 0.05, max: 0.95, step: 0.05 },
  minMeanLuminance: { min: 0, max: 128, step: 1 },
  maxWaitMs: { min: 500, max: 20000, step: 500 },
} as const;

/**
 * Validate and normalize a persisted {@link QualityFilterConfig}.
 *
 * `enabled` is boolean-or-default; the three thresholds are clamped to
 * {@link QUALITY_FILTER_CONSTRAINTS} with non-finite values falling back to the
 * default (a stored `NaN` is `typeof 'number'` and would survive a bare clamp).
 * A missing/nullish group default-fills entirely, so a config persisted before
 * the gate existed loads with the gate DISABLED (its safe default) rather than
 * crashing. `blurMetric` is membership-validated against {@link BLUR_METRIC_IDS}
 * with an explicit `'variance-of-laplacian'` fallback, because the field is
 * OPTIONAL — a config predating the metric toggle must resolve to the original
 * behavior (2026-07-12 blur-metric-toggle plan).
 */
export function validateQualityFilterConfig(
  options: Partial<QualityFilterConfig> | null | undefined
): QualityFilterConfig {
  return validateOptionFields(options, DEFAULT_QUALITY_FILTER, {
    enabled: { kind: 'bool' },
    blurRelativeThreshold: {
      kind: 'num',
      constraint: QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold,
    },
    minMeanLuminance: {
      kind: 'num',
      constraint: QUALITY_FILTER_CONSTRAINTS.minMeanLuminance,
    },
    maxWaitMs: {
      kind: 'num',
      constraint: QUALITY_FILTER_CONSTRAINTS.maxWaitMs,
    },
    // Declared last so the validated object serializes in
    // DEFAULT_QUALITY_FILTER's key order (persisted JSON stays byte-comparable
    // across save→validate).
    blurMetric: {
      kind: 'custom',
      resolve: (opts, fallback) =>
        BLUR_METRIC_IDS.includes(opts.blurMetric as BlurMetricId)
          ? opts.blurMetric
          : (fallback ?? 'variance-of-laplacian'),
    },
  });
}

/** Default number of recent (non-black) sharpness scores the gate keeps. */
export const DEFAULT_SHARPNESS_HISTORY_SIZE = 15;

/**
 * Default minimum samples before the relative blur check engages. Below this the
 * gate is in "cold start" and accepts every non-black frame — the same
 * "no baseline yet ⇒ don't block" principle the motion gate uses for an empty
 * window.
 */
export const DEFAULT_SHARPNESS_MIN_SAMPLES = 3;

/**
 * Compute the **variance of the Laplacian** of a single-channel grayscale image
 * — the standard focus measure (higher ⇒ sharper / more in-focus).
 *
 * The discrete Laplacian per interior pixel is
 * `up + down + left + right − 4·centre` (the 4-neighbour kernel); the score is
 * the variance of that response over all interior pixels. A flat/constant image
 * yields 0; a focused, textured image yields a large value.
 *
 * Defensive: returns `0` (rather than throwing or `NaN`) for any input that has
 * no interior pixels — non-integer or `< 3` dimensions, or a buffer shorter than
 * `width · height`. A tiny negative variance from floating-point cancellation is
 * clamped to 0.
 *
 * @param gray  Row-major single-channel intensities, length ≥ `width · height`.
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 */
export function sharpnessScore(
  gray: Uint8Array | Uint8ClampedArray | readonly number[],
  width: number,
  height: number
): number {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return 0;
  if (width < 3 || height < 3) return 0;
  if (gray.length < width * height) return 0;

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const laplacian =
        gray[i - 1]! +
        gray[i + 1]! +
        gray[i - width]! +
        gray[i + width]! -
        4 * gray[i]!;
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return variance > 0 ? variance : 0;
}

/**
 * Convert an RGBA buffer to a single-channel grayscale (Rec. 601 luma) buffer,
 * the input {@link sharpnessScore} expects. Pure; ignores the alpha channel. A
 * partial trailing pixel (length not a multiple of 4) is ignored.
 */
export function rgbaToGrayscale(
  rgba: Uint8Array | Uint8ClampedArray
): Uint8ClampedArray {
  const pixels = Math.floor(rgba.length / 4);
  const out = new Uint8ClampedArray(pixels);
  for (let p = 0; p < pixels; p++) {
    const o = p * 4;
    out[p] = 0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!;
  }
  return out;
}

/**
 * Mean Rec. 601 luma (`0.299R + 0.587G + 0.114B`) over an RGBA buffer, on a
 * 0–255 scale. Near-zero ⇒ black/empty frame. Alpha is ignored. Returns `0` for
 * an empty buffer.
 */
export function meanLuminance(rgba: Uint8Array | Uint8ClampedArray): number {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return 0;
  let sum = 0;
  for (let p = 0; p < pixels; p++) {
    const o = p * 4;
    sum += 0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!;
  }
  return sum / pixels;
}

/**
 * Frequency-domain focus measure: the fraction of non-DC spectral energy at
 * normalized radial frequency ≥ `cutoff` (default 0.3), computed by FFT over
 * the centered largest power-of-two crop (needs ≥ 8×8, else returns 0).
 * In [0, 1]; higher ⇒ sharper. Unlike {@link sharpnessScore} it is invariant
 * to brightness shift AND contrast scale (it is a ratio). Ported from the
 * investigation benchmark (2026-07-12 toggle plan) where it won the
 * "sharp vs degraded" boundary (AUC 0.838 vs 0.750).
 *
 * Defensive contract identical to {@link sharpnessScore}: non-integer or
 * < 3×3 dims, or a buffer shorter than `width·height`, return 0.
 */
export function highFrequencyEnergyRatio(
  gray: Uint8Array | Uint8ClampedArray | readonly number[],
  width: number,
  height: number,
  cutoff = 0.3
): number {
  if (!hasFftCrop(gray, width, height)) return 0;
  const pw = largestPow2AtMost(width);
  const ph = largestPow2AtMost(height);

  const offX = Math.floor((width - pw) / 2);
  const offY = Math.floor((height - ph) / 2);
  const re = new Float64Array(pw * ph);
  const im = new Float64Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    const srcRow = (y + offY) * width + offX;
    for (let x = 0; x < pw; x++) {
      re[y * pw + x] = gray[srcRow + x]!;
    }
  }
  fft2dInPlace(re, im, pw, ph);
  return highEnergyFraction(re, im, pw, ph, cutoff);
}

/** Same input guard as sharpnessScore, plus the FFT's ≥ 8×8 pow2-crop need. */
function hasFftCrop(
  gray: Uint8Array | Uint8ClampedArray | readonly number[],
  width: number,
  height: number
): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= 8 &&
    height >= 8 &&
    gray.length >= width * height &&
    largestPow2AtMost(width) >= 8 &&
    largestPow2AtMost(height) >= 8
  );
}

/** Largest power of two ≤ n (n ≥ 1). */
function largestPow2AtMost(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/**
 * In-place iterative radix-2 FFT (decimation-in-time). `re`/`im` length must
 * be a power of two (guaranteed by the caller's crop).
 */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let start = 0; start < n; start += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = start + k;
        const b = a + len / 2;
        const vRe = re[b]! * curRe - im[b]! * curIm;
        const vIm = re[b]! * curIm + im[b]! * curRe;
        re[b] = re[a]! - vRe;
        im[b] = im[a]! - vIm;
        re[a] = re[a]! + vRe;
        im[a] = im[a]! + vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** 2D FFT over a pw×ph buffer: rows in place, then columns via scratch. */
function fft2dInPlace(
  re: Float64Array,
  im: Float64Array,
  pw: number,
  ph: number
): void {
  for (let y = 0; y < ph; y++) {
    fftInPlace(
      re.subarray(y * pw, (y + 1) * pw),
      im.subarray(y * pw, (y + 1) * pw)
    );
  }
  const colRe = new Float64Array(ph);
  const colIm = new Float64Array(ph);
  for (let x = 0; x < pw; x++) {
    for (let y = 0; y < ph; y++) {
      colRe[y] = re[y * pw + x]!;
      colIm[y] = im[y * pw + x]!;
    }
    fftInPlace(colRe, colIm);
    for (let y = 0; y < ph; y++) {
      re[y * pw + x] = colRe[y]!;
      im[y * pw + x] = colIm[y]!;
    }
  }
}

/**
 * Fraction of non-DC spectral energy at normalized radial frequency ≥
 * `cutoff` (radius normalized so the diagonal Nyquist bin is exactly 1).
 * The DC bin carries brightness, not sharpness — excluded, which is what
 * makes the ratio exposure-invariant.
 */
function highEnergyFraction(
  re: Float64Array,
  im: Float64Array,
  pw: number,
  ph: number,
  cutoff: number
): number {
  let total = 0;
  let high = 0;
  for (let ky = 0; ky < ph; ky++) {
    const fy = ky <= ph / 2 ? ky : ky - ph;
    const ny = fy / (ph / 2);
    for (let kx = 0; kx < pw; kx++) {
      if (kx === 0 && ky === 0) continue;
      const fx = kx <= pw / 2 ? kx : kx - pw;
      const nx = fx / (pw / 2);
      const i = ky * pw + kx;
      const energy = re[i]! * re[i]! + im[i]! * im[i]!;
      total += energy;
      if (Math.hypot(nx, ny) / Math.SQRT2 >= cutoff) high += energy;
    }
  }
  return total > 0 ? high / total : 0;
}

/**
 * Resolve a {@link BlurMetricId} to its scoring function. `undefined` or an
 * unknown id (e.g. from a persisted config written by a newer/older app
 * version) resolves to {@link sharpnessScore} — the pre-toggle behavior.
 * The (untestable) recorder worker calls this so the mapping stays here,
 * where tests can pin it.
 */
export function blurMetricScorer(
  metric: BlurMetricId | undefined
): (
  gray: Uint8Array | Uint8ClampedArray | readonly number[],
  width: number,
  height: number
) => number {
  return metric === 'high-frequency-energy-ratio'
    ? highFrequencyEnergyRatio
    : sharpnessScore;
}

/** Reason a frame was rejected by the quality gate, or `null` when accepted. */
export type QualityRejectReason = 'black' | 'blurry';

/** Outcome of evaluating one frame against the quality gate. */
export interface QualityVerdict {
  /** `true` to save the frame, `false` to drop + retry. */
  readonly accept: boolean;
  /** Why it was dropped, or `null` when accepted. */
  readonly reason: QualityRejectReason | null;
  /** The frame's variance-of-Laplacian sharpness (for logging/tuning). */
  readonly sharpness: number;
  /** The frame's mean luminance (for logging/tuning). */
  readonly meanLuminance: number;
}

/**
 * The self-calibrating blur+blackness verdict, with the rolling sharpness
 * history that makes the blur check scene-relative (§5). Stateful but pure (no
 * DOM/worker): one instance per recording session, fed each analysed frame's
 * metrics.
 *
 * Policy per frame ({@link evaluate}):
 *  1. **Blackness — absolute.** `meanLuminance < config.minMeanLuminance` ⇒
 *     reject `'black'`. The score is NOT recorded (a black frame's ~0 sharpness
 *     must not drag the median down and disarm the blur check).
 *  2. **Blur — relative.** Once at least `minSamples` non-black frames have been
 *     seen, reject `'blurry'` when `sharpness < blurRelativeThreshold · median`.
 *     Before that (cold start) every non-black frame is accepted.
 *  3. The non-black frame's sharpness is recorded into the rolling window
 *     (capped at `historySize`) so the median tracks the scene's texture level —
 *     including a genuinely softening scene, which gradually lowers the bar (the
 *     §10 "retry storm" regime where the fallback then guarantees progress).
 */
export class ImageQualityGate {
  private readonly history: number[] = [];
  private readonly historySize: number;
  private readonly minSamples: number;

  constructor(
    historySize: number = DEFAULT_SHARPNESS_HISTORY_SIZE,
    minSamples: number = DEFAULT_SHARPNESS_MIN_SAMPLES
  ) {
    this.historySize =
      Number.isFinite(historySize) && historySize >= 1
        ? Math.floor(historySize)
        : DEFAULT_SHARPNESS_HISTORY_SIZE;
    const wantedMinSamples =
      Number.isFinite(minSamples) && minSamples >= 1
        ? Math.floor(minSamples)
        : DEFAULT_SHARPNESS_MIN_SAMPLES;
    // The rolling history never grows past historySize, so a minSamples above
    // it could never be reached — the blur check would silently never arm.
    // Clamp so the gate always warms up once the window is full.
    this.minSamples = Math.min(wantedMinSamples, this.historySize);
  }

  /**
   * Judge one frame from its precomputed metrics + the current config, updating
   * the rolling history. See the class doc for the policy.
   */
  evaluate(
    sharpness: number,
    meanLum: number,
    config: QualityFilterConfig
  ): QualityVerdict {
    // 1. Blackness — absolute, scene-independent. Do not record the score.
    if (meanLum < config.minMeanLuminance) {
      return {
        accept: false,
        reason: 'black',
        sharpness,
        meanLuminance: meanLum,
      };
    }

    // 2. Blur — relative to the established baseline (cold start accepts).
    let blurry = false;
    if (this.history.length >= this.minSamples) {
      const threshold =
        config.blurRelativeThreshold * lowerMedian(this.history);
      if (sharpness < threshold) blurry = true;
    }

    // 3. Record this non-black frame's sharpness as part of the scene baseline.
    this.history.push(sharpness);
    if (this.history.length > this.historySize) this.history.shift();

    return blurry
      ? { accept: false, reason: 'blurry', sharpness, meanLuminance: meanLum }
      : { accept: true, reason: null, sharpness, meanLuminance: meanLum };
  }

  /** Number of (non-black) sharpness samples currently retained. */
  historyLength(): number {
    return this.history.length;
  }

  /** Clear the rolling history (e.g. on a new recording session). */
  reset(): void {
    this.history.length = 0;
  }
}
