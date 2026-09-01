import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_SIGHTING_GAP_MS,
  createQrSightingAccumulator,
  type QrSightingObservation,
} from './qr-sighting-accumulator.js';
import type { Matrix4 as AlignmentMatrix } from '../../core/index.js';

const IDENTITY: AlignmentMatrix = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];
const TEXT = 'code';

function obs(timestamp: number): QrSightingObservation {
  return {
    text: TEXT,
    timestamp,
    odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    sizeM: 0.16,
    alignmentMatrix: IDENTITY,
    zero: { lat: 48, lon: 11 },
    alignmentSampleCount: 5,
  };
}

/** Strictly increasing timestamps, some gaps small and some large. */
const arbTimeline = fc
  .array(fc.integer({ min: 1, max: DEFAULT_SIGHTING_GAP_MS * 2 }), {
    minLength: 1,
    maxLength: 40,
  })
  .map((deltas) => {
    const times: number[] = [0];
    for (const d of deltas) times.push((times.at(-1) ?? 0) + d);
    return times;
  });

describe('createQrSightingAccumulator properties', () => {
  it('splits exactly at the gaps and nowhere else', () => {
    // Why this test matters: the sighting boundary decides what the mint
    // treats as one visit. An off-by-one here silently merges a walk-away
    // and a return into one "sighting", which is exactly the disagreement
    // the fixedness gate is supposed to measure.
    fc.assert(
      fc.property(arbTimeline, (times) => {
        const acc = createQrSightingAccumulator();
        for (const t of times) acc.observe(obs(t));
        acc.flush();

        const expected =
          1 +
          times
            .slice(1)
            .filter((t, i) => t - (times[i] ?? 0) > DEFAULT_SIGHTING_GAP_MS)
            .length;
        expect(acc.sightings(TEXT)).toHaveLength(expected);
      }),
      { numRuns: 200 }
    );
  });

  it('accounts for every detection exactly once', () => {
    // Nothing may be dropped or double-counted: the detection count feeds
    // the level's quality block, where it is read as evidence.
    fc.assert(
      fc.property(arbTimeline, (times) => {
        const acc = createQrSightingAccumulator();
        for (const t of times) acc.observe(obs(t));
        acc.flush();
        const total = acc
          .sightings(TEXT)
          .reduce((sum, s) => sum + s.detectionCount, 0);
        expect(total).toBe(times.length);
      }),
      { numRuns: 200 }
    );
  });

  it('keeps sightings ordered and non-overlapping', () => {
    fc.assert(
      fc.property(arbTimeline, (times) => {
        const acc = createQrSightingAccumulator();
        for (const t of times) acc.observe(obs(t));
        acc.flush();
        const sightings = acc.sightings(TEXT);
        // Collect the two facts first and assert once: an assertion inside a
        // conditional would silently pass a run where the branch never ran.
        const wellFormed = sightings.every(
          (s) => s.firstTimestamp <= s.lastTimestamp
        );
        const ordered = sightings.every(
          (s, i) =>
            i === 0 ||
            s.firstTimestamp > (sightings[i - 1]?.lastTimestamp ?? -Infinity)
        );
        expect({ wellFormed, ordered }).toEqual({
          wellFormed: true,
          ordered: true,
        });
      }),
      { numRuns: 200 }
    );
  });

  it('is unaffected by detections of OTHER codes interleaved with it', () => {
    // Why this test matters: a wall with several posters produces one
    // interleaved stream. Per-code state that leaked between codes would
    // merge two posters' evidence into one anchor.
    fc.assert(
      fc.property(arbTimeline, (times) => {
        const alone = createQrSightingAccumulator();
        const mixed = createQrSightingAccumulator();
        for (const t of times) {
          alone.observe(obs(t));
          mixed.observe(obs(t));
          mixed.observe({ ...obs(t), text: 'other' });
        }
        alone.flush();
        mixed.flush();
        expect(mixed.sightings(TEXT)).toEqual(alone.sightings(TEXT));
      }),
      { numRuns: 100 }
    );
  });
});
