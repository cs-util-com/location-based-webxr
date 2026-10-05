/**
 * Tests for the shared coverage map and disc (globe volume-cloud plan
 * 2026-10-05-0016, C1 and C3).
 *
 * Why this file matters: the globe's clouds are one map; the volume near the
 * camera and its shadow on the ground must both put their clouds where the
 * map has them, or the slab and its shadow disagree with each other and with
 * the shell. The map gives a cover per column, and the cover becomes a
 * threshold through the noise's own quantiles, the rule the global cover
 * uses; the disc fades it to clear at its edge. One implementation for both
 * shaders (DEC-H3).
 */
import { describe, expect, it } from 'vitest';

import { cloudThreshold } from './cloud-layer.js';
import {
  CLOUD_COVERAGE_GLSL,
  cloudCoverThresholds,
  cloudCoverageUniforms,
  cloudDiscThreshold,
  cloudThresholdForCover,
  withCloudCoverage,
} from './cloud-coverage.js';

describe('the cover table', () => {
  it('tabulates the threshold for 33 covers from the noise quantiles', () => {
    const table = cloudCoverThresholds();
    expect(table).toHaveLength(33);
    expect(table[0]).toBe(2); // cover 0: clear (above any noise)
    for (let k = 1; k <= 32; k++) {
      expect(table[k]).toBeCloseTo(Math.min(cloudThreshold(k / 32), 2), 12);
      expect(table[k]).toBeLessThanOrEqual(table[k - 1]!);
    }
    expect(cloudCoverThresholds()).toBe(table); // computed once
  });

  it('interpolates the threshold between table entries and clamps the cover', () => {
    const table = cloudCoverThresholds();
    expect(cloudThresholdForCover(0)).toBe(2);
    expect(cloudThresholdForCover(1)).toBe(table[32]);
    expect(cloudThresholdForCover(0.5)).toBeCloseTo(table[16]!, 12);
    expect(cloudThresholdForCover(17 / 64)).toBeCloseTo(
      0.5 * (table[8]! + table[9]!),
      12
    );
    expect(cloudThresholdForCover(-1)).toBe(2);
    expect(cloudThresholdForCover(2)).toBe(table[32]);
    expect(() => cloudThresholdForCover(Number.NaN)).toThrow(RangeError);
  });
});

describe('the disc', () => {
  // WHY: the volume draws a disc around the camera and the shell the rest;
  // the disc's edge must fade, not cut.
  it('fades the threshold to clear from 0.7 R to R around the camera', () => {
    expect(cloudDiscThreshold(0.6, 0, 20_000)).toBe(0.6);
    expect(cloudDiscThreshold(0.6, 14_000, 20_000)).toBe(0.6);
    expect(cloudDiscThreshold(0.6, 20_000, 20_000)).toBe(2);
    expect(cloudDiscThreshold(0.6, 50_000, 20_000)).toBe(2);
    const mid = cloudDiscThreshold(0.6, 17_000, 20_000);
    expect(mid).toBeGreaterThan(0.6);
    expect(mid).toBeLessThan(2);
    let last = 0.6;
    for (let d = 0; d <= 25_000; d += 500) {
      const t = cloudDiscThreshold(0.6, d, 20_000);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
    expect(() => cloudDiscThreshold(0.6, 100, 0)).toThrow(RangeError);
    expect(() => cloudDiscThreshold(0.6, -1, 100)).toThrow(RangeError);
  });
});

describe('CLOUD_COVERAGE_GLSL', () => {
  // The GPU half: opt-in by defines, so without them the threshold is the
  // caller's own.
  it('reads the coverage and the disc only behind their defines', () => {
    const g = CLOUD_COVERAGE_GLSL;
    expect(g).toContain('#ifdef ATM_CLOUD_COVERAGE');
    expect(g).toContain('uniform float atmCoverThresholds[33];');
    expect(g).toContain('#ifdef ATM_CLOUD_DISC');
    expect(g).toContain('uniform float atmCoverDiscM;');
    expect(g).toContain(
      'float atmCloudThresholdAt(vec2 xz, float threshold, float cover)'
    );
    expect(g).toContain('atmCloudCoverageAt(xz) * cover');
  });

  it('declares neutral uniforms until a coverage and a disc are set', () => {
    const u = cloudCoverageUniforms();
    expect(u.atmCoverThresholds.value).toEqual(new Array(33).fill(2));
    expect(u.atmCoverDiscM.value).toBe(1);
    expect(cloudCoverageUniforms().atmCoverThresholds).not.toBe(
      u.atmCoverThresholds
    );
  });

  it('inserts a caller chunk that defines atmCloudCoverageAt, and refuses one that does not', () => {
    const chunk =
      'uniform float uFlat;\nfloat atmCloudCoverageAt(vec2 xz) { return uFlat; }';
    const out = withCloudCoverage(`a\n${CLOUD_COVERAGE_GLSL}\nb`, chunk);
    expect(out).toContain(chunk);
    expect(out).not.toContain('// atm-cloud-coverage-chunk');
    expect(() =>
      withCloudCoverage(CLOUD_COVERAGE_GLSL, 'float other() { return 0.0; }')
    ).toThrow(RangeError);
    expect(() => withCloudCoverage('no chunk here', chunk)).toThrow(RangeError);
  });
});
