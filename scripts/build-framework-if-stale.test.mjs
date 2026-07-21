// Why this test matters: build-framework-if-stale.mjs SKIPS a build the e2e
// suites depend on. A wrong "fresh" verdict means Playwright tests run
// against a stale framework dist — the documented "consumers resolve through
// built dist" footgun — so the decision function must fail open in every
// ambiguous case.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isBuildRequired } from './build-framework-if-stale.mjs';

describe('isBuildRequired', () => {
  it('builds when dist is missing/empty (null output mtime)', () => {
    expect(isBuildRequired(1000, null)).toBe(true);
  });

  it('builds when inputs could not be determined (null input mtime)', () => {
    expect(isBuildRequired(null, 1000)).toBe(true);
    expect(isBuildRequired(null, null)).toBe(true);
  });

  it('builds when the newest input is newer than the oldest dist file', () => {
    expect(isBuildRequired(2000, 1000)).toBe(true);
  });

  it('builds on exact mtime ties (partial-build ambiguity fails open)', () => {
    expect(isBuildRequired(1000, 1000)).toBe(true);
  });

  it('skips only when every dist file is strictly newer than every input', () => {
    expect(isBuildRequired(1000, 1001)).toBe(false);
  });

  it('property: never skips unless both mtimes exist and dist is strictly newer', () => {
    fc.assert(
      fc.property(
        fc.option(fc.nat(), { nil: null }),
        fc.option(fc.nat(), { nil: null }),
        (input, output) => {
          const required = isBuildRequired(input, output);
          if (!required) {
            expect(input).not.toBeNull();
            expect(output).not.toBeNull();
            expect(/** @type {number} */ (output)).toBeGreaterThan(
              /** @type {number} */ (input)
            );
          }
        }
      )
    );
  });
});
