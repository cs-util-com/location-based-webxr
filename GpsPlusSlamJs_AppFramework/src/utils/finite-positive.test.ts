import { describe, expect, it } from 'vitest';
import { finitePositive, worse } from './finite-positive.js';

describe('finitePositive', () => {
  // Why this test matters: accuracies, sizes and extents come from sensors
  // and files; only a finite number above zero may be judged by.
  it('passes a finite positive number and maps anything else to null', () => {
    expect(finitePositive(3.5)).toBe(3.5);
    expect(finitePositive(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
    for (const bad of [
      0,
      -0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '3',
      null,
      undefined,
      {},
    ]) {
      expect(finitePositive(bad)).toBeNull();
    }
  });
});

describe('worse', () => {
  // Why this test matters: two accuracies combine to the larger; a missing
  // one never hides the other.
  it('takes the larger of two accuracies, either alone when the other is null', () => {
    expect(worse(3, 7)).toBe(7);
    expect(worse(7, 3)).toBe(7);
    expect(worse(null, 4)).toBe(4);
    expect(worse(4, null)).toBe(4);
    expect(worse(null, null)).toBeNull();
  });
});
