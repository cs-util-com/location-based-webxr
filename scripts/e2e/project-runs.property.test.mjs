// Why these properties matter: the merged report is what the gate's timing
// row and CI read, so whatever the split, it must count every test exactly
// once and fail if any project failed; and a spec filter must select exactly
// the one spec it names among any set of file names, or a narrowed run would
// silently run a different spec.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { mergeReports, specFilter } from './project-runs.mjs';

const count = fc.nat({ max: 10_000 });
const stats = fc.record({ expected: count, unexpected: count, flaky: count, skipped: count, duration: count });

describe('project-runs properties', () => {
  it('merge sums every count over any number of reports', () => {
    fc.assert(
      fc.property(fc.array(stats, { minLength: 1, maxLength: 5 }), (all) => {
        const merged = mergeReports(all.map((s) => ({ suites: [{}], errors: [], stats: { ...s } })));
        for (const key of ['expected', 'unexpected', 'flaky', 'skipped', 'duration']) {
          expect(merged.stats[key]).toBe(all.reduce((sum, s) => sum + s[key], 0));
        }
        expect(merged.suites).toHaveLength(all.length);
      })
    );
  });

  it('a spec filter matches its own spec and no other name', () => {
    const name = fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,20}\.spec\.js$/);
    fc.assert(
      fc.property(name, fc.array(name, { maxLength: 8 }), (target, others) => {
        const re = new RegExp(specFilter(target), 'gi');
        expect(re.test(`/pkg/playwright-tests/${target}`)).toBe(true);
        for (const other of others) {
          re.lastIndex = 0;
          if (other.toLowerCase() !== target.toLowerCase()) {
            expect(re.test(`/pkg/playwright-tests/${other}`)).toBe(false);
          }
        }
      })
    );
  });
});
