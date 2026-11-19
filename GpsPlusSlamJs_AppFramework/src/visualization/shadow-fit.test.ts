/**
 * Unit tests for the shadow fit's examples and its input validation.
 *
 * Why this file matters: these helpers sit between the orbit camera and the
 * shadow camera, so a NaN that slipped through would freeze the cached map
 * or place the light at infinity without any error; every bad input must
 * throw instead. The worked examples pin the plan's numbers (a step table,
 * a ramp, a fade far plane) so a changed default is a visible diff.
 */
import { describe, expect, it } from 'vitest';

import {
  FADE_START_DEPTH,
  SHADOW_FIT,
  nearFadeFar,
  nearShadowHalfWidth,
  shadowCasterDistance,
  shadowStrengthAt,
  snapShadowCentre,
  wholeSquareFar,
} from './shadow-fit.js';
import { sunShadowPose } from './sun-shadow-rig.js';

const up45: [number, number, number] = [0, Math.SQRT1_2, Math.SQRT1_2];

describe('nearShadowHalfWidth', () => {
  it('rounds k x distance up to the next step and clamps at both ends', () => {
    expect(nearShadowHalfWidth(50)).toBe(120);
    expect(nearShadowHalfWidth(120)).toBe(120);
    expect(nearShadowHalfWidth(121)).toBe(170);
    expect(nearShadowHalfWidth(226)).toBe(240);
    expect(nearShadowHalfWidth(226, { k: 1.5 })).toBe(340);
    expect(nearShadowHalfWidth(9000)).toBe(600);
    expect(nearShadowHalfWidth(10, { steps: [5, 20] })).toBe(20);
  });

  it('throws for a bad distance, k or step list', () => {
    for (const d of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => nearShadowHalfWidth(d)).toThrow(RangeError);
    }
    expect(() => nearShadowHalfWidth(100, { k: 0 })).toThrow(RangeError);
    for (const steps of [[], [200, 100], [0, 100], [100, 100]]) {
      expect(() => nearShadowHalfWidth(100, { steps })).toThrow(RangeError);
    }
  });
});

describe('shadowStrengthAt', () => {
  it('ramps linearly from the floor to full strength', () => {
    expect(SHADOW_FIT.floorDeg).toBe(2);
    expect(SHADOW_FIT.fullDeg).toBe(8);
    expect(shadowStrengthAt(-5)).toBe(0);
    expect(shadowStrengthAt(2)).toBe(0);
    expect(shadowStrengthAt(5)).toBeCloseTo(0.5, 12);
    expect(shadowStrengthAt(8)).toBe(1);
    expect(shadowStrengthAt(60)).toBe(1);
  });

  it('throws for non-finite values or a full strength at or below the floor', () => {
    expect(() => shadowStrengthAt(Number.NaN)).toThrow(RangeError);
    expect(() => shadowStrengthAt(5, { floorDeg: 8, fullDeg: 8 })).toThrow(
      RangeError
    );
    expect(() => shadowStrengthAt(5, { fullDeg: Number.NaN })).toThrow(
      RangeError
    );
  });
});

describe('snapShadowCentre', () => {
  it('keeps a centre already on the grid and handles a sun at the zenith', () => {
    expect(snapShadowCentre([0, 0, 0], up45, 240, 2048)).toEqual([0, 0, 0]);
    const zenith = snapShadowCentre([0.1, 0, 0.1], [0, 1, 0], 1024, 1024);
    expect(zenith[0]).toBeCloseTo(0, 12);
    expect(zenith[2]).toBeCloseTo(0, 12);
  });

  it('throws for a non-finite input, R <= 0 or a bad map size', () => {
    expect(() => snapShadowCentre([Number.NaN, 0, 0], up45, 240, 2048)).toThrow(
      RangeError
    );
    expect(() =>
      snapShadowCentre([0, 0, 0], [0, Number.NaN, 0], 240, 2048)
    ).toThrow(RangeError);
    expect(() => snapShadowCentre([0, 0, 0], up45, 0, 2048)).toThrow(
      RangeError
    );
    for (const size of [0, 1.5, -2]) {
      expect(() => snapShadowCentre([0, 0, 0], up45, 240, size)).toThrow(
        RangeError
      );
    }
  });
});

describe('shadowCasterDistance', () => {
  const city = {
    centre: [0, 0, 0] as const,
    halfExtentM: 2000,
    maxHeightM: 160,
  };

  it('reaches the farthest box corner toward the sun when that is below the cap', () => {
    // Sun due +z at 45 degrees from the centre of the box: the far corner at
    // the tallest height is 2000 cos 45 + 160 sin 45 metres up the sun.
    const d = shadowCasterDistance({
      centre: [0, 0, 0],
      sunDir: up45,
      halfWidthM: 240,
      city,
      marginM: 0,
    });
    expect(d).toBeCloseTo((2000 + 160) * Math.SQRT1_2, 9);
  });

  it('never stands closer than R plus the margin', () => {
    const d = shadowCasterDistance({
      centre: [0, 0, 2000],
      sunDir: up45,
      halfWidthM: 600,
      city: { ...city, maxHeightM: 0 },
    });
    expect(d).toBe(600 + SHADOW_FIT.marginM);
  });

  it('throws for bad input', () => {
    const base = {
      centre: [0, 0, 0] as const,
      sunDir: up45,
      halfWidthM: 240,
      city,
    };
    expect(() => shadowCasterDistance({ ...base, halfWidthM: 0 })).toThrow(
      RangeError
    );
    expect(() =>
      shadowCasterDistance({ ...base, centre: [Number.NaN, 0, 0] })
    ).toThrow(RangeError);
    expect(() =>
      shadowCasterDistance({ ...base, city: { ...city, maxHeightM: -1 } })
    ).toThrow(RangeError);
    expect(() =>
      shadowCasterDistance({ ...base, city: { ...city, halfExtentM: 0 } })
    ).toThrow(RangeError);
    expect(() => shadowCasterDistance({ ...base, marginM: -1 })).toThrow(
      RangeError
    );
    for (const floorDeg of [0, 90, Number.NaN]) {
      expect(() => shadowCasterDistance({ ...base, floorDeg })).toThrow(
        RangeError
      );
    }
  });
});

describe('far planes', () => {
  it('nearFadeFar is (D + f R) / 0.98 and validates its input', () => {
    expect(FADE_START_DEPTH).toBe(0.98);
    expect(nearFadeFar(1000, 240)).toBeCloseTo((1000 + 0.9 * 240) / 0.98, 9);
    expect(nearFadeFar(1000, 240, 0.8)).toBeCloseTo(
      (1000 + 0.8 * 240) / 0.98,
      9
    );
    expect(() => nearFadeFar(0, 240)).toThrow(RangeError);
    expect(() => nearFadeFar(1000, -1)).toThrow(RangeError);
    for (const f of [0, 1.01, Number.NaN]) {
      expect(() => nearFadeFar(1000, 240, f)).toThrow(RangeError);
    }
  });

  it('wholeSquareFar reaches a corner of the square', () => {
    expect(wholeSquareFar(1000, 600)).toBeCloseTo(1000 + 600 * Math.SQRT2, 9);
    expect(() => wholeSquareFar(Number.NaN, 600)).toThrow(RangeError);
    expect(() => wholeSquareFar(1000, 0)).toThrow(RangeError);
  });

  it('sunShadowPose takes a far plane beyond D and refuses one that is not', () => {
    const pose = sunShadowPose({
      sunDir: up45,
      centre: [0, 0, 0],
      halfWidthM: 240,
      distanceM: 1000,
      farM: 1300,
    });
    expect(pose.bounds.far).toBe(1300);
    for (const farM of [1000, 900, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        sunShadowPose({
          sunDir: up45,
          centre: [0, 0, 0],
          halfWidthM: 240,
          distanceM: 1000,
          farM,
        })
      ).toThrow(RangeError);
    }
  });
});
