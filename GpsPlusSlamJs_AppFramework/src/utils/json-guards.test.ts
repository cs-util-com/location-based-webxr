import { describe, expect, it } from 'vitest';
import { isFiniteNumber, isJsonObject, isRecord } from './json-guards.js';

describe('json guards', () => {
  // Why this test matters: the Tour Viewer's stored-record readers rely on
  // isJsonObject rejecting arrays (a stored list where a record belongs is
  // damage, not a record), while isRecord keeps accepting them for the
  // parsers that narrow further. One shared guard, so its edges are pinned
  // here rather than in each reader.
  it('isJsonObject takes a plain object and rejects arrays, null and primitives', () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject({ a: 1 })).toBe(true);
    expect(isJsonObject(Object.create(null))).toBe(true);
    for (const v of [[], [1], null, undefined, 0, 'x', true]) {
      expect(isJsonObject(v), String(v)).toBe(false);
    }
  });

  it('isRecord takes arrays too, and rejects null and primitives', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true);
    for (const v of [null, undefined, 0, 'x', true]) {
      expect(isRecord(v), String(v)).toBe(false);
    }
  });

  it('isFiniteNumber rejects NaN, the infinities and non-numbers', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-1.5)).toBe(true);
    for (const v of [Number.NaN, Infinity, -Infinity, '1', null]) {
      expect(isFiniteNumber(v), String(v)).toBe(false);
    }
  });
});
