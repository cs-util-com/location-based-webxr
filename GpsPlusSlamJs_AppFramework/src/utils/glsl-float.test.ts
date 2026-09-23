/**
 * Tests for the package's one GLSL float-literal formatter.
 *
 * Why this file matters: GLSL ES has no implicit int → float conversion, so a
 * constant written as `6360` in a float expression is a compile error, and a
 * three.js compile error only logs while the material silently stops
 * drawing. The previous private copy (`toFixed(4)`) also rounded 1e-9 to
 * "0.0000" and wrote NaN as "NaN"; both reach a shader without an error.
 */
import { describe, expect, it } from 'vitest';

import { glslFloat } from './glsl-float.js';

describe('glslFloat', () => {
  it.each([
    [6360, '6360.00000'],
    [0.8, '0.800000000'],
    [5.802e-3, '0.00580200000'],
    [1e-9, '1.00000000e-9'],
  ])('writes %s as a float literal', (value, text) => {
    expect(glslFloat(value)).toBe(text);
  });

  it('refuses a non-finite number rather than emitting "NaN" into a shader', () => {
    expect(() => glslFloat(Number.NaN)).toThrow(RangeError);
    expect(() => glslFloat(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
