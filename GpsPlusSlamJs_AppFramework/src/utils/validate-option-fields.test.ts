/**
 * Tests for validate-option-fields.ts
 *
 * Why these tests matter: this primitive is the framework's single answer to
 * "a persisted options blob is untrusted input". Every consumer app reloads
 * option groups from localStorage / recording metadata, and each rule here
 * exists because the naive version of it has a hole:
 * - a bare `clamp` lets a stored `NaN` through (`typeof NaN === 'number'`),
 * - a bare `typeof value === 'number'` lets `Infinity` through,
 * - a bare assignment lets an unknown enum member through,
 * - and building the result from the INPUT's keys (rather than the spec's)
 *   makes the serialized JSON key order depend on what was stored, breaking
 *   byte-comparable save→load round-trips.
 */

import { describe, it, expect } from 'vitest';
import {
  validateOptionFields,
  type GroupSpec,
} from './validate-option-fields.js';

interface SampleGroup {
  enabled: boolean;
  threshold: number;
  count: number;
  mode: 'fast' | 'slow';
  nested: { inner: number };
}

const DEFAULTS: SampleGroup = {
  enabled: true,
  threshold: 0.5,
  count: 3,
  mode: 'fast',
  nested: { inner: 1 },
};

const SPEC: GroupSpec<SampleGroup> = {
  enabled: { kind: 'bool' },
  threshold: { kind: 'num', constraint: { min: 0.05, max: 0.95 } },
  count: { kind: 'num', constraint: { min: 1, max: 10 }, round: true },
  mode: { kind: 'enum', values: ['fast', 'slow'] },
  nested: {
    kind: 'custom',
    resolve: (options, fallback) =>
      typeof options.nested?.inner === 'number'
        ? { inner: options.nested.inner }
        : fallback,
  },
};

const validate = (options: Partial<SampleGroup> | null | undefined) =>
  validateOptionFields(options, DEFAULTS, SPEC);

describe('validateOptionFields', () => {
  it('returns the defaults for an empty, null or undefined group', () => {
    expect(validate({})).toEqual(DEFAULTS);
    expect(validate(null)).toEqual(DEFAULTS);
    expect(validate(undefined)).toEqual(DEFAULTS);
  });

  it('preserves every valid value', () => {
    const input: SampleGroup = {
      enabled: false,
      threshold: 0.2,
      count: 7,
      mode: 'slow',
      nested: { inner: 42 },
    };
    expect(validate(input)).toEqual(input);
  });

  describe("kind: 'bool'", () => {
    it('accepts only a real boolean, falling back to the default otherwise', () => {
      expect(validate({ enabled: false }).enabled).toBe(false);
      for (const junk of ['false', 0, 1, null, {}]) {
        expect(validate({ enabled: junk as unknown as boolean }).enabled).toBe(
          DEFAULTS.enabled
        );
      }
    });
  });

  describe("kind: 'num'", () => {
    it('clamps to the constraint window', () => {
      expect(validate({ threshold: -5 }).threshold).toBe(0.05);
      expect(validate({ threshold: 99 }).threshold).toBe(0.95);
    });

    // Why: `typeof NaN === 'number'` and `clamp(NaN, …)` returns NaN, so a
    // clamp-only guard would let a corrupt stored value reach the consumer.
    it('falls back to the default for NaN, Infinity and non-numbers', () => {
      for (const junk of [NaN, Infinity, -Infinity, '0.4', null, {}]) {
        expect(
          validate({ threshold: junk as unknown as number }).threshold
        ).toBe(DEFAULTS.threshold);
      }
    });

    it('rounds before clamping when `round` is set', () => {
      expect(validate({ count: 4.6 }).count).toBe(5);
      // Rounding first is what makes the clamp bound exact: 10.4 → 10, not 10.4.
      expect(validate({ count: 10.4 }).count).toBe(10);
      expect(validate({ count: 0.2 }).count).toBe(1);
    });

    // Why: the fallback goes through the same round+clamp path, so a default
    // that sits outside its own constraint would be silently corrected rather
    // than passed through — this pins that a valid default survives untouched.
    it('leaves an in-range default untouched when the input is junk', () => {
      expect(validate({ count: 'x' as unknown as number }).count).toBe(
        DEFAULTS.count
      );
    });
  });

  describe("kind: 'enum'", () => {
    it('accepts only declared members', () => {
      expect(validate({ mode: 'slow' }).mode).toBe('slow');
      for (const junk of ['FAST', 'medium', 0, null]) {
        expect(
          validate({ mode: junk as unknown as SampleGroup['mode'] }).mode
        ).toBe(DEFAULTS.mode);
      }
    });
  });

  describe("kind: 'custom'", () => {
    it('receives the whole raw group and its own default as fallback', () => {
      expect(validate({ nested: { inner: 9 } }).nested).toEqual({ inner: 9 });
      expect(
        validate({ nested: { inner: 'x' } as unknown as { inner: number } })
          .nested
      ).toEqual(DEFAULTS.nested);
    });
  });

  // Why this test matters: persisted options are compared byte-wise across
  // save→load cycles in the recorder's round-trip tests. Building the result
  // from the input's keys would make the order depend on what was stored.
  it('emits keys in the SPEC declaration order, not the input order', () => {
    const scrambled = {
      mode: 'slow',
      enabled: false,
      nested: { inner: 2 },
      count: 4,
      threshold: 0.3,
    } as SampleGroup;
    expect(Object.keys(validate(scrambled))).toEqual(Object.keys(SPEC));
  });

  // Why: unknown keys in a persisted blob (a removed field, another app
  // version) must not survive into the validated object.
  it('drops keys the spec does not declare', () => {
    const withLegacy = { enabled: false, legacyFlag: true } as unknown as
      | Partial<SampleGroup>
      | undefined;
    expect(validate(withLegacy)).not.toHaveProperty('legacyFlag');
  });

  it('never mutates the input or the defaults', () => {
    const defaultsBefore = structuredClone(DEFAULTS);
    const input: Partial<SampleGroup> = { threshold: 999 };
    validate(input);
    expect(input).toEqual({ threshold: 999 });
    expect(DEFAULTS).toEqual(defaultsBefore);
  });
});
