import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { configureStore } from '@reduxjs/toolkit';
import { arSpaceCorrectionReducer } from '../state/ar-space-correction-slice';
import {
  RELOCALIZATION_JUMP_M,
  RELOCALIZATION_MAX_GAP_MS,
  createRelocalizationFeed,
} from './relocalization-feed';

/** A frame: a time step, a position step, or a lost pose. */
const frameArb = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.record({
      dt: fc.double({ min: 1, max: 700, noNaN: true }),
      dx: fc.double({ min: -2, max: 2, noNaN: true }),
      dz: fc.double({ min: -2, max: 2, noNaN: true }),
    }),
  },
  { weight: 1, arbitrary: fc.constant(null) }
);

describe('relocalization feed (properties)', () => {
  it('dispatches exactly at the frames an independent model calls jumps, in time order, always valid', () => {
    // Why this test matters: over any mix of walking, jumps, stalls and
    // lost poses, the feed must observe exactly the judgeable jumps, and
    // every observation must pass the reducer (none refused).
    fc.assert(
      fc.property(fc.array(frameArb, { maxLength: 60 }), (frames) => {
        const store = configureStore({
          reducer: { arSpaceCorrection: arSpaceCorrectionReducer },
        });
        const feed = createRelocalizationFeed({ getStore: () => store });
        let t = 1000;
        let x = 0;
        let z = 0;
        let model: { t: number; x: number; z: number } | null = null;
        const expected: number[] = [];
        for (const f of frames) {
          if (f === null) {
            t += 33;
            feed.frame(t, null);
            model = null;
            continue;
          }
          t += f.dt;
          x += f.dx;
          z += f.dz;
          feed.frame(t, { position: [x, 1.5, z], rotation: [0, 0, 0, 1] });
          if (
            model !== null &&
            t - model.t <= RELOCALIZATION_MAX_GAP_MS &&
            Math.hypot(x - model.x, z - model.z) > RELOCALIZATION_JUMP_M
          ) {
            expected.push(t);
          }
          model = { t, x, z };
        }
        const obs = store.getState().arSpaceCorrection.observations;
        expect(obs.map((o) => o.t)).toEqual(expected);
        for (const o of obs) {
          expect(o.t - o.tLast).toBeLessThanOrEqual(RELOCALIZATION_MAX_GAP_MS);
        }
        expect(feed.isStopped()).toBe(false);
      })
    );
  });
});
