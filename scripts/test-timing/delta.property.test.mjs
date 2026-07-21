// Why this test matters: pins the flag semantics against an independent
// reference model for ALL duration pairs — sign symmetry and "flag implies
// BOTH thresholds exceeded" fall out of the model equality, so no future
// tweak can silently weaken the AND rule.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeDelta } from './delta.mjs';

const durationArb = fc.integer({ min: 1, max: 10_000_000 });

/**
 * @param {number} durationMs
 * @param {string} [machine]
 * @returns {import('./delta.mjs').Recording}
 */
function rec(durationMs, machine = 'M1') {
  return {
    ts: '2026-07-02T12:00:00+02:00',
    durationMs,
    tests: null,
    machine,
    git: null,
  };
}

/**
 * Independent reference model of the agreed flag rule (§2/§5 of the plan).
 * @param {number} current
 * @param {number} previous
 * @returns {'slower' | 'faster' | 'same'}
 */
function referenceFlag(current, previous) {
  const deltaMs = current - previous;
  const exceedsBoth =
    Math.abs(deltaMs) > 2000 && Math.abs(deltaMs) / previous > 0.2;
  if (!exceedsBoth) {
    return 'same';
  }
  return deltaMs > 0 ? 'slower' : 'faster';
}

describe('computeDelta properties', () => {
  it('matches the reference model in both directions (implies sign symmetry and the AND rule)', () => {
    fc.assert(
      fc.property(durationArb, durationArb, (a, b) => {
        expect(computeDelta([rec(a), rec(b)]).flag).toBe(referenceFlag(a, b));
        expect(computeDelta([rec(b), rec(a)]).flag).toBe(referenceFlag(b, a));
      })
    );
  });

  it('kind is fully determined by the machine sequence', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('M1', 'M2'), { minLength: 1, maxLength: 6 }),
        (machines) => {
          const history = machines.map((m) => rec(5000, m));
          const expectedKind =
            machines.length === 1
              ? 'first'
              : machines.slice(1).includes(machines[0])
                ? 'compared'
                : 'baseline-reset';
          expect(computeDelta(history).kind).toBe(expectedKind);
        }
      )
    );
  });
});
