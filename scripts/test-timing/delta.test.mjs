// Why this test matters: the delta/flag logic IS the product — a wrong flag
// either spams false regressions (agents learn to ignore it) or hides real
// ones. The both-thresholds rule (>20% AND >2s) and same-machine comparison
// are the two noise defenses agreed in the plan (§2, §5).
import { describe, it, expect } from 'vitest';
import { computeDelta } from './delta.mjs';

/**
 * Helper to build a recording entry with defaults.
 * @param {{ durationMs: number, machine?: string, tests?: import('./delta.mjs').TestCounts | null, ts?: string, git?: string | null }} partial
 * @returns {import('./delta.mjs').Recording}
 */
function rec({
  durationMs,
  machine = 'M1',
  tests = null,
  ts = '2026-07-02T12:00:00+02:00',
  git = 'abc1234',
}) {
  return { ts, durationMs, tests, machine, git };
}

describe('computeDelta', () => {
  it('throws on an empty history (nothing to describe)', () => {
    expect(() => computeDelta([])).toThrow(TypeError);
  });

  it('reports the first-ever recording as kind "first" with no flag', () => {
    expect(computeDelta([rec({ durationMs: 1000 })])).toEqual({
      kind: 'first',
      flag: null,
      deltaTests: null,
    });
  });

  it('reports a machine change as baseline reset (no cross-machine deltas)', () => {
    const history = [
      rec({ durationMs: 9000, machine: 'M2' }),
      rec({ durationMs: 1000, machine: 'M1' }),
    ];
    expect(computeDelta(history)).toEqual({
      kind: 'baseline-reset',
      flag: null,
      deltaTests: null,
    });
  });

  it('flags slower only when BOTH >20% and >2s are exceeded', () => {
    const history = [rec({ durationMs: 12000 }), rec({ durationMs: 8600 })];
    const delta = computeDelta(history);
    expect(delta.kind).toBe('compared');
    expect(delta.deltaMs).toBe(3400);
    expect(delta.flag).toBe('slower');
  });

  it('flags faster for the mirrored improvement', () => {
    const history = [rec({ durationMs: 8600 }), rec({ durationMs: 12000 })];
    expect(computeDelta(history).flag).toBe('faster');
  });

  it('stays "same" when only the percentage threshold is exceeded (+50% but +1.5s)', () => {
    const history = [rec({ durationMs: 4500 }), rec({ durationMs: 3000 })];
    expect(computeDelta(history).flag).toBe('same');
  });

  it('stays "same" when only the absolute threshold is exceeded (+3s but +10%)', () => {
    const history = [rec({ durationMs: 33000 }), rec({ durationMs: 30000 })];
    expect(computeDelta(history).flag).toBe('same');
  });

  it('stays "same" at exactly the thresholds (strictly-greater semantics)', () => {
    // +20% and +2s exactly: 10s -> 12s
    const history = [rec({ durationMs: 12000 }), rec({ durationMs: 10000 })];
    expect(computeDelta(history).flag).toBe('same');
  });

  it('compares against the previous SAME-machine entry, skipping other machines', () => {
    const history = [
      rec({ durationMs: 12000, machine: 'M1' }),
      rec({ durationMs: 500, machine: 'M2' }),
      rec({ durationMs: 8600, machine: 'M1' }),
    ];
    const delta = computeDelta(history);
    expect(delta.kind).toBe('compared');
    expect(delta.deltaMs).toBe(3400);
    expect(delta.flag).toBe('slower');
  });

  it('reports test-count delta from passed counts when both entries have counts', () => {
    const history = [
      rec({
        durationMs: 1000,
        tests: { passed: 758, failed: 0, skipped: 2, todo: 0 },
      }),
      rec({
        durationMs: 1000,
        tests: { passed: 755, failed: 0, skipped: 2, todo: 0 },
      }),
    ];
    expect(computeDelta(history).deltaTests).toBe(3);
  });

  it('reports null test delta when either entry lacks counts', () => {
    const history = [
      rec({
        durationMs: 1000,
        tests: { passed: 758, failed: 0, skipped: 0, todo: 0 },
      }),
      rec({ durationMs: 1000, tests: null }),
    ];
    expect(computeDelta(history).deltaTests).toBeNull();
  });

  it('rejects malformed entries defensively (non-finite duration)', () => {
    expect(() => computeDelta([rec({ durationMs: Number.NaN })])).toThrow(
      TypeError
    );
  });
});
