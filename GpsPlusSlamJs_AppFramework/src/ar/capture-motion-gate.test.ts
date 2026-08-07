/**
 * Tests for the capture motion gate (decision + sliding window).
 *
 * Why this matters: this is the policy that decides whether a due frame is calm
 * enough to capture or must be deferred. The cases pin the four behaviours the
 * plan (2026-06-23-2105-blurry-frame-motion-gating-plan.md §4.2-4.4) requires:
 *  - calm frame captures, fast frame defers,
 *  - the never-calm safety fallback eventually captures (no silent gap),
 *  - a tracking-glitch spike is rejected (does not pollute the window, so it
 *    neither forces a spurious defer nor counts as calm), and
 *  - an empty window reads as "not calm" (no capture before any valid sample).
 */

import { describe, it, expect } from 'vitest';
import {
  decideCapture,
  MotionWindow,
  DEFAULT_MOTION_WINDOW_SIZE,
  DEFAULT_MOTION_FILTER,
  MOTION_FILTER_CONSTRAINTS,
  validateMotionFilterConfig,
} from './capture-motion-gate.js';

const THRESHOLDS = {
  maxAngularVelocity: 0.6,
  maxLinearVelocity: 0.5,
  maxWaitMs: 4000,
};

describe('decideCapture', () => {
  it('captures when motion is within both thresholds', () => {
    expect(
      decideCapture({
        windowMaxAngular: 0.2,
        windowMaxLinear: 0.1,
        msSinceDue: 0,
        ...THRESHOLDS,
      })
    ).toBe('capture');
  });

  it('defers when angular velocity exceeds its threshold', () => {
    expect(
      decideCapture({
        windowMaxAngular: 1.5,
        windowMaxLinear: 0.0,
        msSinceDue: 0,
        ...THRESHOLDS,
      })
    ).toBe('defer');
  });

  it('defers when linear velocity exceeds its threshold', () => {
    expect(
      decideCapture({
        windowMaxAngular: 0.1,
        windowMaxLinear: 2.0,
        msSinceDue: 100,
        ...THRESHOLDS,
      })
    ).toBe('defer');
  });

  it('captures regardless of motion once maxWaitMs has elapsed (safety fallback)', () => {
    expect(
      decideCapture({
        windowMaxAngular: 99,
        windowMaxLinear: 99,
        msSinceDue: 4000,
        ...THRESHOLDS,
      })
    ).toBe('capture');
  });

  it('still defers a fast frame just before the fallback deadline', () => {
    expect(
      decideCapture({
        windowMaxAngular: 99,
        windowMaxLinear: 99,
        msSinceDue: 3999,
        ...THRESHOLDS,
      })
    ).toBe('defer');
  });

  it('treats an empty window (Infinity) as not calm', () => {
    expect(
      decideCapture({
        windowMaxAngular: Number.POSITIVE_INFINITY,
        windowMaxLinear: Number.POSITIVE_INFINITY,
        msSinceDue: 0,
        ...THRESHOLDS,
      })
    ).toBe('defer');
  });
});

describe('MotionWindow', () => {
  it('reports Infinity for both maxima when empty (no valid data yet)', () => {
    const w = new MotionWindow();
    expect(w.maxAngular()).toBe(Number.POSITIVE_INFINITY);
    expect(w.maxLinear()).toBe(Number.POSITIVE_INFINITY);
  });

  it('hasSamples() reflects whether any valid sample was recorded', () => {
    const w = new MotionWindow(3);
    expect(w.hasSamples()).toBe(false);
    w.push(1000, 1000); // glitch — rejected, still no samples
    expect(w.hasSamples()).toBe(false);
    w.push(0.2, 0.1);
    expect(w.hasSamples()).toBe(true);
    w.reset();
    expect(w.hasSamples()).toBe(false);
  });

  it('returns the max over the retained window', () => {
    const w = new MotionWindow(3);
    w.push(0.1, 0.05);
    w.push(0.4, 0.2);
    w.push(0.2, 0.1);
    expect(w.maxAngular()).toBeCloseTo(0.4, 9);
    expect(w.maxLinear()).toBeCloseTo(0.2, 9);
  });

  it('drops samples older than the window size', () => {
    const w = new MotionWindow(2);
    w.push(0.9, 0.9); // will be evicted
    w.push(0.1, 0.1);
    w.push(0.2, 0.2);
    // The 0.9 spike is no longer in the last-2 window.
    expect(w.maxAngular()).toBeCloseTo(0.2, 9);
    expect(w.maxLinear()).toBeCloseTo(0.2, 9);
  });

  it('rejects a glitch-spike sample: it never enters the window', () => {
    const w = new MotionWindow(3);
    w.push(0.1, 0.1);
    w.push(0.2, 0.2);
    const accepted = w.push(1000, 1000); // relocalization teleport
    expect(accepted).toBe(false);
    // The spike did not pollute the window — max is unchanged, so a glitch
    // cannot force a spurious defer.
    expect(w.maxAngular()).toBeCloseTo(0.2, 9);
    expect(w.maxLinear()).toBeCloseTo(0.2, 9);
  });

  it('accepts in-range samples (returns true)', () => {
    const w = new MotionWindow(3);
    expect(w.push(0.3, 0.3)).toBe(true);
  });

  it('reset() clears the window back to the empty (Infinity) state', () => {
    const w = new MotionWindow(3);
    w.push(0.3, 0.3);
    w.reset();
    expect(w.maxAngular()).toBe(Number.POSITIVE_INFINITY);
  });

  it('exposes a sane default window size', () => {
    expect(DEFAULT_MOTION_WINDOW_SIZE).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_MOTION_WINDOW_SIZE).toBeLessThanOrEqual(5);
  });
});

describe('DEFAULT_MOTION_FILTER', () => {
  it('is enabled by default with sane placeholder thresholds', () => {
    expect(DEFAULT_MOTION_FILTER.enabled).toBe(true);
    expect(DEFAULT_MOTION_FILTER.maxAngularVelocity).toBeGreaterThan(0);
    expect(DEFAULT_MOTION_FILTER.maxLinearVelocity).toBeGreaterThan(0);
    // maxWaitMs ~ 2x the default 2000ms image interval.
    expect(DEFAULT_MOTION_FILTER.maxWaitMs).toBeGreaterThanOrEqual(2000);
  });
});

/**
 * Why these tests matter: a MotionFilterConfig survives page reloads inside a
 * consumer app's persisted settings, so it comes back as untrusted input. The
 * gate owns what its own numbers mean, so it owns their bounds — these pin that
 * a corrupt or pre-feature stored value can never disable capture or make the
 * gate inert. (They moved here from the recorder catalog, which used to encode
 * this gate's ranges in its own table.)
 */
describe('validateMotionFilterConfig', () => {
  it('default-fills an empty, null or undefined group (gate stays ENABLED)', () => {
    for (const empty of [{}, null, undefined]) {
      expect(validateMotionFilterConfig(empty)).toEqual(DEFAULT_MOTION_FILTER);
    }
  });

  it('honors an explicit enabled=false', () => {
    expect(validateMotionFilterConfig({ enabled: false }).enabled).toBe(false);
  });

  it('clamps thresholds to MOTION_FILTER_CONSTRAINTS', () => {
    expect(
      validateMotionFilterConfig({ maxAngularVelocity: 0 }).maxAngularVelocity
    ).toBe(MOTION_FILTER_CONSTRAINTS.maxAngularVelocity.min);
    expect(validateMotionFilterConfig({ maxWaitMs: 999999 }).maxWaitMs).toBe(
      MOTION_FILTER_CONSTRAINTS.maxWaitMs.max
    );
  });

  // A stored NaN is `typeof 'number'` and would survive a bare clamp.
  it('falls back to the default for non-finite thresholds', () => {
    expect(
      validateMotionFilterConfig({ maxLinearVelocity: NaN }).maxLinearVelocity
    ).toBe(DEFAULT_MOTION_FILTER.maxLinearVelocity);
  });

  it('brackets every default inside its own constraint window', () => {
    for (const key of [
      'maxAngularVelocity',
      'maxLinearVelocity',
      'maxWaitMs',
    ] as const) {
      expect(DEFAULT_MOTION_FILTER[key]).toBeGreaterThanOrEqual(
        MOTION_FILTER_CONSTRAINTS[key].min
      );
      expect(DEFAULT_MOTION_FILTER[key]).toBeLessThanOrEqual(
        MOTION_FILTER_CONSTRAINTS[key].max
      );
    }
  });
});
