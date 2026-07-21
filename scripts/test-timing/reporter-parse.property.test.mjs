// Why this test matters: parsers must round-trip any well-formed reporter
// stats and reject anything else with TypeError (never NaN/undefined counts,
// which would poison the timing history downstream).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseVitestCounts, parsePlaywrightCounts } from './reporter-parse.mjs';

const countArb = fc.nat({ max: 100_000 });

describe('reporter-parse properties', () => {
  it('round-trips arbitrary well-formed vitest reports', () => {
    fc.assert(
      fc.property(countArb, countArb, countArb, countArb, (p, f, s, t) => {
        const json = JSON.stringify({
          numPassedTests: p,
          numFailedTests: f,
          numPendingTests: s,
          numTodoTests: t,
        });
        expect(parseVitestCounts(json)).toEqual({
          passed: p,
          failed: f,
          skipped: s,
          todo: t,
        });
      })
    );
  });

  it('round-trips arbitrary well-formed playwright stats (flaky folds into passed)', () => {
    fc.assert(
      fc.property(countArb, countArb, countArb, countArb, (e, u, s, fl) => {
        const json = JSON.stringify({
          stats: { expected: e, unexpected: u, skipped: s, flaky: fl },
        });
        expect(parsePlaywrightCounts(json)).toEqual({
          passed: e + fl,
          failed: u,
          skipped: s,
          todo: 0,
        });
      })
    );
  });

  it('always throws TypeError (never returns junk) for non-object JSON', () => {
    fc.assert(
      fc.property(
        fc
          .oneof(fc.integer(), fc.string(), fc.boolean())
          .map((v) => JSON.stringify(v)),
        (json) => {
          expect(() => parseVitestCounts(json)).toThrow(TypeError);
          expect(() => parsePlaywrightCounts(json)).toThrow(TypeError);
        }
      )
    );
  });
});
