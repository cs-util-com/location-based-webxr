// Why this test matters: the watchdog's one promise to a healthy stage is
// that output keeps it alive. For any limit and any sequence of output
// chunks that arrive closer together than the limit, the clock never
// reports a stall at any moment before the next chunk; and once the stage
// goes quiet for the limit, it always does.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { silenceClock } from './stall-watch.mjs';

describe('silenceClock properties', () => {
  it('never stalls while chunks arrive closer than the limit, always stalls after', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 1_000_000 }),
        fc.array(fc.double({ min: 0, max: 0.999, noNaN: true }), { maxLength: 50 }),
        fc.array(fc.double({ min: 0, max: 0.999, noNaN: true }), { minLength: 1, maxLength: 5 }),
        (limitMs, gapShares, probeShares) => {
          const clock = silenceClock(limitMs, 0);
          let now = 0;
          for (const share of gapShares) {
            const gap = Math.floor(share * limitMs);
            // Polls anywhere inside the gap see no stall.
            for (const probe of probeShares) {
              expect(clock.check(now + Math.floor(probe * gap)).stalled).toBe(false);
            }
            now += gap;
            clock.heard(now);
          }
          expect(clock.check(now + limitMs - 1).stalled).toBe(false);
          expect(clock.check(now + limitMs).stalled).toBe(true);
          // No gap it saw reached the limit, so neither does the longest.
          expect(clock.longest(now)).toBeLessThan(limitMs);
        }
      )
    );
  });
});
