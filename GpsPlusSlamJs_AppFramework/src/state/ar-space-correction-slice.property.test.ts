/**
 * Property tests for the `arSpaceCorrection` slice: what a random stream of
 * valid and invalid observations leaves in the state.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  arSpaceCorrectionReducer,
  relocalizationObserved,
  type ArSpaceCorrectionState,
  type RelocalizationObservation,
} from './ar-space-correction-slice';

const STILL: RelocalizationObservation['lastPose'] = {
  position: [0, 1.6, 0],
  rotation: [0, 0, 0, 1],
};

/** One candidate: a time, and whether it carries a broken pose. */
const candidate = fc.record({
  t: fc.integer({ min: 100, max: 10_000 }),
  broken: fc.boolean(),
  extra: fc.boolean(),
});

describe('ar-space-correction-slice (properties)', () => {
  it('keeps exactly the valid observations, in order, with non-decreasing times and only the six fields', () => {
    // Why this test matters: epochs count observations by time (binary
    // search), so the stored list must stay sorted whatever arrives, a
    // refused observation must leave no trace, and a recorded payload must
    // hold nothing beyond the raw observation.
    fc.assert(
      fc.property(fc.array(candidate, { maxLength: 30 }), (candidates) => {
        let state: ArSpaceCorrectionState | undefined;
        const expected: number[] = [];
        for (const c of candidates) {
          const o = {
            t: c.t,
            tLast: c.t - 33,
            lastPose: STILL,
            tPrev: c.t - 66,
            prevPose: STILL,
            newPose: c.broken
              ? { position: [Number.NaN, 0, 0], rotation: [0, 0, 0, 1] }
              : { position: [3, 1.6, 0], rotation: [0, 0, 0, 1] },
            ...(c.extra ? { note: 'derived' } : {}),
          } as RelocalizationObservation;
          state = arSpaceCorrectionReducer(state, relocalizationObserved(o));
          const last = expected[expected.length - 1];
          if (!c.broken && (last === undefined || c.t >= last)) {
            expected.push(c.t);
          }
        }
        const stored = state?.observations ?? [];
        expect(stored.map((o) => o.t)).toEqual(expected);
        for (const o of stored) {
          expect(Object.keys(o).sort()).toEqual(
            ['lastPose', 'newPose', 'prevPose', 't', 'tLast', 'tPrev'].sort()
          );
        }
      })
    );
  });
});
