import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  advanceOutOfViewRuns,
  endOutOfViewRun,
  freshOutOfViewRun,
  type OutOfViewRunState,
} from './out-of-view-queue';

const N = 5;

describe('out-of-view queue (property)', () => {
  // Why this test matters: the queue is the verdict's bound, so it must be
  // exactly the distinct entries out of view during the run, whatever the
  // churn: more lets a starved key pass, fewer fails a fair schedule. The
  // oracle recomputes that set by brute force over the pass history.
  it('equals the distinct entries out of view during each run', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            out: fc.uniqueArray(fc.integer({ min: 0, max: N - 1 }), {
              maxLength: N,
            }),
            end: fc.uniqueArray(fc.integer({ min: 0, max: N - 1 }), {
              maxLength: N,
            }),
          }),
          { maxLength: 40 }
        ),
        (passes) => {
          const all: OutOfViewRunState[] = Array.from(
            { length: N },
            freshOutOfViewRun
          );
          const history: Set<number>[] = [];
          passes.forEach(({ out, end }, pass) => {
            // As in the set: an entry in a run that is not out this pass
            // is held in view (or no longer pending), and its run ends.
            all.forEach((s, i) => {
              if (s.outFrames > 0 && !out.includes(i)) endOutOfViewRun(s);
            });
            advanceOutOfViewRuns(
              pass,
              out.map((i) => all[i]!),
              all
            );
            history.push(new Set(out));
            all.forEach((s) => {
              if (s.outFrames === 0) return;
              const seen = new Set<number>();
              for (let p = s.outSince; p <= pass; p += 1) {
                for (const i of history[p]!) seen.add(i);
              }
              expect(s.queued).toBe(seen.size);
              expect(s.outFrames).toBe(pass - s.outSince + 1);
            });
            for (const i of end) endOutOfViewRun(all[i]!);
          });
        }
      )
    );
  });
});
