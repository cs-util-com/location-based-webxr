/**
 * Elevation-Offset Estimator property tests.
 *
 * Why this test matters:
 * The estimator's hard invariants must hold for ANY tick stream, not just
 * the handcrafted scenarios:
 * - a non-null output is always finite and never leaves the range of the
 *   sample values that were admitted (the slew limiter interpolates toward
 *   window medians, and a frozen value is a snapshot of such an output — so
 *   an offset outside the observed sample range could only come from an
 *   arithmetic bug, and would place content at a height no sample ever
 *   supported);
 * - arbitrary junk (NaN/±Infinity sample fields, empty ticks, zero time
 *   deltas) on a monotone-time stream never throws and never poisons the
 *   published state (a NaN offset would propagate into rendered
 *   transforms);
 * - a freeze + unfreeze round trip leaves the estimator fully functional —
 *   frozen state must never wedge the instance.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createElevationOffsetEstimator,
  type ElevationOffsetSample,
  type ElevationOffsetState,
  type ElevationOffsetTick,
} from './elevation-offset-estimator';
import { gaussOf, mulberry32 } from '../test-utils/elevation-offset-scenarios';

/**
 * Seeded walking-stream runner for the freeze round-trip property: feeds
 * level stretches and ramps of the baseline-free delta while the camera
 * walks east, collecting every published state.
 */
function makeRoundTripRunner(seed: number): {
  states: ElevationOffsetState[];
  feedLevel: (ticks: number, baseM: number) => void;
  feedRamp: (fromM: number, toExclusiveM: number, stepM: number) => void;
} {
  const rng = mulberry32(seed);
  const est = createElevationOffsetEstimator();
  const states: ElevationOffsetState[] = [];
  let i = 0;
  const feed = (baseM: number): void => {
    const posE = i * 1.4;
    const tick: ElevationOffsetTick = {
      tMs: i * 1000,
      posE,
      posN: 0,
      cameraYar: 1.6 + baseM,
      samples: Array.from({ length: 6 }, () => ({
        sampleM: baseM + gaussOf(rng) * 0.1,
        confidence: 0.8,
        posE: posE + (rng() * 2 - 1) * 2,
        posN: (rng() * 2 - 1) * 2,
      })),
    };
    states.push(est.update(tick));
    i++;
  };
  const feedLevel = (ticks: number, baseM: number): void => {
    for (let k = 0; k < ticks; k++) {
      feed(baseM);
    }
  };
  const feedRamp = (
    fromM: number,
    toExclusiveM: number,
    stepM: number
  ): void => {
    for (
      let v = fromM;
      stepM > 0 ? v < toExclusiveM : v > toExclusiveM;
      v += stepM
    ) {
      feed(v);
    }
  };
  return { states, feedLevel, feedRamp };
}

/** Well-formedness shared by all properties (single unconditional expect). */
function isWellFormed(state: ElevationOffsetState): boolean {
  const confidenceOk = state.confidence >= 0 && state.confidence <= 1;
  if (state.offsetM == null) {
    // No output: never "frozen at nothing", and confidence reports 0.
    return confidenceOk && !state.frozen && state.confidence === 0;
  }
  return confidenceOk && Number.isFinite(state.offsetM);
}

describe('elevation-offset estimator properties', () => {
  it('non-null output stays finite and within the range of admitted samples', () => {
    const tickSpecArb = fc.record({
      baseM: fc.double({ min: -30, max: 30, noNaN: true }),
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
      count: fc.integer({ min: 0, max: 6 }),
      stepE: fc.double({ min: -3, max: 3, noNaN: true }),
      stepN: fc.double({ min: -3, max: 3, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(tickSpecArb, { minLength: 1, maxLength: 80 }),
        (specs) => {
          const est = createElevationOffsetEstimator();
          let posE = 0;
          let posN = 0;
          let minM = Number.POSITIVE_INFINITY;
          let maxM = Number.NEGATIVE_INFINITY;
          let ok = true;
          for (let i = 0; i < specs.length; i++) {
            const s = specs[i];
            if (s == null) {
              continue;
            }
            posE += s.stepE;
            posN += s.stepN;
            if (s.count > 0) {
              minM = Math.min(minM, s.baseM);
              maxM = Math.max(maxM, s.baseM);
            }
            const samples: ElevationOffsetSample[] = Array.from(
              { length: s.count },
              () => ({
                sampleM: s.baseM,
                confidence: s.confidence,
                posE,
                posN,
              })
            );
            const state = est.update({
              tMs: i * 700,
              posE,
              posN,
              cameraYar: 1.6,
              samples,
            });
            const inRange =
              state.offsetM == null ||
              (state.offsetM >= minM - 1e-9 && state.offsetM <= maxM + 1e-9);
            ok = ok && isWellFormed(state) && inRange;
          }
          expect(ok).toBe(true);
        }
      ),
      { numRuns: 40 }
    );
  });

  it('monotone time plus arbitrary junk samples never throws and never poisons the state', () => {
    // fc.double() without constraints deliberately includes NaN and ±∞.
    const junkSampleArb = fc.record({
      sampleM: fc.double(),
      confidence: fc.double(),
      posE: fc.double(),
      posN: fc.double(),
    });
    const junkTickArb = fc.record({
      dtMs: fc.integer({ min: 0, max: 5000 }),
      posE: fc.double({ min: -50, max: 50, noNaN: true }),
      posN: fc.double({ min: -50, max: 50, noNaN: true }),
      cameraYar: fc.double(),
      samples: fc.array(junkSampleArb, { maxLength: 6 }),
    });
    fc.assert(
      fc.property(fc.array(junkTickArb, { maxLength: 60 }), (ticks) => {
        const est = createElevationOffsetEstimator();
        let tMs = 0;
        let ok = true;
        for (const t of ticks) {
          tMs += t.dtMs;
          const state = est.update({
            tMs,
            posE: t.posE,
            posN: t.posN,
            cameraYar: t.cameraYar,
            samples: t.samples,
          });
          ok = ok && isWellFormed(state);
        }
        // Reaching this line at all proves "never throws"; the flag proves
        // the state stayed well-formed under the junk.
        expect(ok).toBe(true);
      }),
      { numRuns: 60 }
    );
  });

  it('freeze + unfreeze round trip leaves the estimator functional', () => {
    fc.assert(
      fc.property(
        fc.record({
          seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
          stepM: fc.double({ min: 6, max: 15, noNaN: true }),
          dwellTicks: fc.integer({ min: 30, max: 150 }),
        }),
        ({ seed, stepM, dwellTicks }) => {
          const run = makeRoundTripRunner(seed);
          // Ground → climb → dwell on top → descend → ground again.
          run.feedLevel(30, 0);
          run.feedRamp(2, stepM, 2);
          run.feedLevel(dwellTicks, stepM);
          run.feedRamp(stepM - 2, 0, -2);
          run.feedLevel(60, 0);
          // The climb froze the estimator...
          expect(run.states.some((s) => s.frozen)).toBe(true);
          // ...and the return to ground unfroze it and re-converged it.
          const last = run.states[run.states.length - 1];
          expect(last?.frozen).toBe(false);
          expect(Math.abs((last?.offsetM ?? 99) - 0)).toBeLessThan(1);
          // Still fully functional after the round trip: it keeps tracking.
          run.feedLevel(10, 0.5);
          const tail = run.states[run.states.length - 1];
          expect(tail?.offsetM).not.toBeNull();
          expect(Number.isFinite(tail?.offsetM ?? Number.NaN)).toBe(true);
        }
      ),
      { numRuns: 15 }
    );
  });
});
