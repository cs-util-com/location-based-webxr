/**
 * Unit tests for the pure image-quality metrics + verdict policy.
 *
 * Why this matters: these are the building blocks the off-thread image gate
 * relies on. The metrics must rank a sharp frame above a blurred one and flag a
 * black frame; the verdict policy must (a) never block before it has a baseline,
 * (b) reject blur only relative to the recent scene, and (c) never let a black
 * frame's ~0 sharpness poison the baseline. Each is pinned here so the worker
 * (the untested device layer) can be a thin shell over this logic.
 */

import { describe, it, expect } from 'vitest';
import {
  sharpnessScore,
  highFrequencyEnergyRatio,
  blurMetricScorer,
  BLUR_METRIC_IDS,
  type BlurMetricId,
  meanLuminance,
  rgbaToGrayscale,
  ImageQualityGate,
  DEFAULT_QUALITY_FILTER,
  QUALITY_FILTER_CONSTRAINTS,
  validateQualityFilterConfig,
  type QualityFilterConfig,
} from './image-quality.js';

/** A w×h checkerboard (0/255) — maximally high-frequency, so very "sharp". */
function checkerboard(w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out.push((x + y) % 2 === 0 ? 255 : 0);
    }
  }
  return out;
}

/** 3×3 box blur with edge-clamped neighbours — smooths high frequencies. */
function boxBlur(gray: readonly number[], w: number, h: number): number[] {
  const at = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(w - 1, x));
    const cy = Math.max(0, Math.min(h - 1, y));
    return gray[cy * w + cx] as number;
  };
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) sum += at(x + dx, y + dy);
      }
      out.push(sum / 9);
    }
  }
  return out;
}

describe('sharpnessScore', () => {
  it('scores a sharp checkerboard far above its blurred copy', () => {
    const w = 16;
    const h = 16;
    const sharp = checkerboard(w, h);
    const blurred = boxBlur(sharp, w, h);
    const sSharp = sharpnessScore(sharp, w, h);
    const sBlur = sharpnessScore(blurred, w, h);
    expect(sSharp).toBeGreaterThan(0);
    expect(sBlur).toBeLessThan(sSharp);
  });

  it('is 0 for a constant (flat) image — no high-frequency content', () => {
    const w = 8;
    const h = 8;
    const flat = new Array(w * h).fill(128);
    expect(sharpnessScore(flat, w, h)).toBe(0);
  });

  it('is invariant to a uniform brightness offset (Laplacian cancels DC)', () => {
    const w = 10;
    const h = 10;
    const base = checkerboard(w, h).map((v) => v / 4); // keep < 255 after +offset
    const brighter = base.map((v) => v + 30);
    expect(sharpnessScore(brighter, w, h)).toBeCloseTo(
      sharpnessScore(base, w, h),
      6
    );
  });

  it('returns 0 for degenerate dimensions or short buffers (defensive)', () => {
    expect(sharpnessScore([1, 2, 3, 4], 2, 2)).toBe(0); // < 3 px each side
    expect(sharpnessScore([1, 2, 3], 3, 3)).toBe(0); // buffer too short
    expect(sharpnessScore(checkerboard(4, 4), 2.5, 4)).toBe(0); // non-integer
  });
});

describe('meanLuminance', () => {
  it('is 0 for an all-black buffer and ~255 for an all-white buffer', () => {
    const black = new Uint8ClampedArray(4 * 16); // all zero incl. alpha
    const white = new Uint8ClampedArray(4 * 16).fill(255);
    expect(meanLuminance(black)).toBe(0);
    expect(meanLuminance(white)).toBeCloseTo(255, 5);
  });

  it('is ~128 for a mid-grey buffer', () => {
    const grey = new Uint8ClampedArray(4 * 16);
    for (let p = 0; p < 16; p++) {
      grey[p * 4] = 128;
      grey[p * 4 + 1] = 128;
      grey[p * 4 + 2] = 128;
      grey[p * 4 + 3] = 255;
    }
    expect(meanLuminance(grey)).toBeCloseTo(128, 5);
  });

  it('returns 0 for an empty buffer', () => {
    expect(meanLuminance(new Uint8ClampedArray(0))).toBe(0);
  });
});

describe('rgbaToGrayscale', () => {
  it('maps each pixel to its Rec. 601 luma and ignores alpha', () => {
    // One pure-red, one pure-green, one pure-blue pixel.
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128,
    ]);
    const gray = rgbaToGrayscale(rgba);
    expect(gray.length).toBe(3);
    expect(gray[0]).toBe(Math.round(0.299 * 255)); // 76 (clamped)
    expect(gray[1]).toBe(Math.round(0.587 * 255)); // 150
    expect(gray[2]).toBe(Math.round(0.114 * 255)); // 29
  });
});

describe('ImageQualityGate', () => {
  const cfg: QualityFilterConfig = {
    ...DEFAULT_QUALITY_FILTER,
    enabled: true,
    blurRelativeThreshold: 0.5,
    minMeanLuminance: 10,
  };

  it('accepts during cold start (before minSamples), even a low score', () => {
    const gate = new ImageQualityGate(15, 3);
    // First three frames: no baseline yet → accept regardless of sharpness.
    expect(gate.evaluate(1, 200, cfg).accept).toBe(true);
    expect(gate.evaluate(1000, 200, cfg).accept).toBe(true);
    expect(gate.evaluate(5, 200, cfg).accept).toBe(true);
  });

  it('rejects a frame far below the recent sharpness median once warmed up', () => {
    const gate = new ImageQualityGate(15, 3);
    // Establish a sharp baseline (median 100).
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    // 40 < 0.5·100 = 50 → blurry.
    const v = gate.evaluate(40, 200, cfg);
    expect(v.accept).toBe(false);
    expect(v.reason).toBe('blurry');
    // 60 > 50 → accepted.
    expect(gate.evaluate(60, 200, cfg).accept).toBe(true);
  });

  it('rejects a black frame on the absolute cutoff', () => {
    const gate = new ImageQualityGate(15, 3);
    const v = gate.evaluate(9999, 5, cfg); // very sharp but luminance 5 < 10
    expect(v.accept).toBe(false);
    expect(v.reason).toBe('black');
  });

  it('does NOT let a black frame pollute the sharpness baseline', () => {
    const gate = new ImageQualityGate(15, 3);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    expect(gate.historyLength()).toBe(3);
    // A black frame with ~0 sharpness must be ignored for the baseline...
    gate.evaluate(0, 1, cfg);
    expect(gate.historyLength()).toBe(3); // unchanged
    // ...so the median is still 100 and a 40-score frame is still blurry.
    expect(gate.evaluate(40, 200, cfg).reason).toBe('blurry');
  });

  it('caps the rolling history at historySize (no unbounded growth)', () => {
    const gate = new ImageQualityGate(4, 3);
    for (let i = 0; i < 20; i++) gate.evaluate(100, 200, cfg);
    expect(gate.historyLength()).toBe(4);
  });

  it('arms the blur check even when minSamples exceeds historySize (clamped — PR #124/#127 review)', () => {
    // Why this test matters: the rolling history is capped at historySize, so
    // an unclamped minSamples > historySize could NEVER be reached — the blur
    // check silently never armed and every blurry frame passed forever.
    const gate = new ImageQualityGate(3, 10);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg); // history full (3) — must count as warmed up
    const v = gate.evaluate(40, 200, cfg); // 40 < 0.5·100 → blurry
    expect(v.accept).toBe(false);
    expect(v.reason).toBe('blurry');
  });

  it('reset() clears the baseline back to cold start', () => {
    const gate = new ImageQualityGate(15, 3);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    gate.evaluate(100, 200, cfg);
    gate.reset();
    expect(gate.historyLength()).toBe(0);
    // Back in cold start → a tiny score is accepted again.
    expect(gate.evaluate(1, 200, cfg).accept).toBe(true);
  });
});

/** Deterministic LCG so the noise-based checks are reproducible. */
function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function noiseImage(w: number, h: number, seed: number): number[] {
  const rnd = makeLcg(seed);
  return Array.from({ length: w * h }, () => Math.floor(rnd() * 200));
}

describe('highFrequencyEnergyRatio', () => {
  // Why these tests matter: the toggleable second gate metric must rank
  // frames the same way it did in the offline benchmark it was promoted
  // from; the single-bin spectral cases pin the FFT + band-split math
  // exactly, and the defensive contract must match sharpnessScore so the
  // worker can swap metrics without new failure modes.

  it('is ~0 for a single low-frequency sinusoid and ~1 for a checkerboard', () => {
    const w = 32;
    const h = 32;
    // All AC energy in bin (1, 0): normalized radius ~0.044 < cutoff 0.3.
    const lowFreq = Array.from({ length: w * h }, (_, i) => {
      const x = i % w;
      return 128 + 100 * Math.sin((2 * Math.PI * x) / w);
    });
    expect(highFrequencyEnergyRatio(lowFreq, w, h)).toBeLessThan(0.05);
    // Checkerboard = the (Nyquist, Nyquist) bin: normalized radius 1.
    expect(highFrequencyEnergyRatio(checkerboard(w, h), w, h)).toBeGreaterThan(
      0.95
    );
  });

  it('blur strictly reduces the ratio on a noise image', () => {
    const w = 32;
    const h = 32;
    const sharp = noiseImage(w, h, 1234);
    const blurred = boxBlur(sharp, w, h);
    const rSharp = highFrequencyEnergyRatio(sharp, w, h);
    const rBlur = highFrequencyEnergyRatio(blurred, w, h);
    expect(rSharp).toBeGreaterThan(0);
    expect(rBlur).toBeLessThan(rSharp);
  });

  it('returns 0 for flat, degenerate, short-buffer, and sub-8x8 inputs', () => {
    expect(highFrequencyEnergyRatio(new Array(32 * 32).fill(50), 32, 32)).toBe(
      0
    );
    expect(highFrequencyEnergyRatio([1, 2, 3, 4], 2, 2)).toBe(0);
    expect(highFrequencyEnergyRatio([1, 2, 3], 3, 3)).toBe(0);
    expect(highFrequencyEnergyRatio(new Array(32 * 32).fill(0), 31.5, 32)).toBe(
      0
    );
    // 7x7: largest pow2 crop is 4x4 < 8x8 minimum.
    expect(
      highFrequencyEnergyRatio(
        Array.from({ length: 49 }, (_, i) => i),
        7,
        7
      )
    ).toBe(0);
  });

  it('scores the centered power-of-two crop for non-pow2 dims', () => {
    // 33-wide image whose first 32 columns are a checkerboard: the crop
    // (offset 0) sees exactly the 32x32 checkerboard, so the extra constant
    // column must not change the score.
    const w = 33;
    const h = 32;
    const gray = Array.from({ length: w * h }, (_, i) => {
      const x = i % w;
      const y = (i - x) / w;
      return x < 32 ? ((x + y) % 2 === 0 ? 0 : 255) : 50;
    });
    expect(highFrequencyEnergyRatio(gray, w, h)).toBeCloseTo(
      highFrequencyEnergyRatio(checkerboard(32, 32), 32, 32),
      8
    );
  });
});

describe('blurMetricScorer', () => {
  // Why this test matters: the worker is the untested device seam - the
  // metric-id -> function mapping (incl. the undefined/unknown fallback for
  // persisted pre-toggle configs) must be pinned HERE so the worker stays a
  // thin shell.

  it('maps each id to its function; undefined/unknown fall back to VoL', () => {
    expect(blurMetricScorer('variance-of-laplacian')).toBe(sharpnessScore);
    expect(blurMetricScorer('high-frequency-energy-ratio')).toBe(
      highFrequencyEnergyRatio
    );
    expect(blurMetricScorer(undefined)).toBe(sharpnessScore);
    expect(blurMetricScorer('bogus' as BlurMetricId)).toBe(sharpnessScore);
  });

  it('BLUR_METRIC_IDS lists exactly the two ids with the default first', () => {
    expect(BLUR_METRIC_IDS).toEqual([
      'variance-of-laplacian',
      'high-frequency-energy-ratio',
    ]);
  });

  it('DEFAULT_QUALITY_FILTER pins variance-of-laplacian (pre-toggle behavior)', () => {
    expect(DEFAULT_QUALITY_FILTER.blurMetric).toBe('variance-of-laplacian');
  });
});

/**
 * Why these tests matter: a QualityFilterConfig survives page reloads inside a
 * consumer app's persisted settings, so it comes back as untrusted input. The
 * gate owns what its own numbers mean, so it owns their bounds — these pin that
 * a corrupt or pre-feature stored value can never turn the gate on by itself,
 * push a threshold outside the range where the check is meaningful, or lose the
 * pre-toggle blur-metric behaviour. (They moved here from the recorder catalog,
 * which used to encode this gate's ranges in its own table.)
 */
describe('validateQualityFilterConfig', () => {
  it('default-fills an empty, null or undefined group (gate stays DISABLED)', () => {
    for (const empty of [{}, null, undefined]) {
      expect(validateQualityFilterConfig(empty)).toEqual(
        DEFAULT_QUALITY_FILTER
      );
      expect(validateQualityFilterConfig(empty).enabled).toBe(false);
    }
  });

  it('honors an explicit enabled=true', () => {
    expect(validateQualityFilterConfig({ enabled: true }).enabled).toBe(true);
  });

  it('falls back to OFF for a non-boolean enabled (never self-enables)', () => {
    expect(
      validateQualityFilterConfig({
        enabled: 'yes' as unknown as boolean,
      }).enabled
    ).toBe(false);
  });

  it('clamps thresholds to QUALITY_FILTER_CONSTRAINTS', () => {
    expect(
      validateQualityFilterConfig({ blurRelativeThreshold: 9 })
        .blurRelativeThreshold
    ).toBe(QUALITY_FILTER_CONSTRAINTS.blurRelativeThreshold.max);
    expect(
      validateQualityFilterConfig({ minMeanLuminance: -5 }).minMeanLuminance
    ).toBe(QUALITY_FILTER_CONSTRAINTS.minMeanLuminance.min);
  });

  // A stored NaN is `typeof 'number'` and would survive a bare clamp.
  it('falls back to the default for non-finite thresholds', () => {
    expect(validateQualityFilterConfig({ maxWaitMs: NaN }).maxWaitMs).toBe(
      DEFAULT_QUALITY_FILTER.maxWaitMs
    );
  });

  /**
   * `blurMetric` is OPTIONAL, so it is the one field whose fallback cannot come
   * from the defaults alone — a config written before the metric toggle existed
   * must resolve to variance-of-Laplacian, the behaviour it was tuned under.
   */
  it('keeps a known blurMetric and maps missing/unknown to variance-of-laplacian', () => {
    for (const id of BLUR_METRIC_IDS) {
      expect(validateQualityFilterConfig({ blurMetric: id }).blurMetric).toBe(
        id
      );
    }
    expect(validateQualityFilterConfig({}).blurMetric).toBe(
      'variance-of-laplacian'
    );
    expect(
      validateQualityFilterConfig({
        blurMetric: 'sobel' as unknown as BlurMetricId,
      }).blurMetric
    ).toBe('variance-of-laplacian');
  });

  it('brackets every numeric default inside its own constraint window', () => {
    for (const key of [
      'blurRelativeThreshold',
      'minMeanLuminance',
      'maxWaitMs',
    ] as const) {
      expect(DEFAULT_QUALITY_FILTER[key]).toBeGreaterThanOrEqual(
        QUALITY_FILTER_CONSTRAINTS[key].min
      );
      expect(DEFAULT_QUALITY_FILTER[key]).toBeLessThanOrEqual(
        QUALITY_FILTER_CONSTRAINTS[key].max
      );
    }
  });
});
