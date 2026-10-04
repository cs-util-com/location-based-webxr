/**
 * Why these tests matter: since core 1.26 a recording can carry GPS
 * observations in TWO action types - `gpsData/recordGpsEvent` (one) and
 * `gpsData/recordGpsEventBatch` (several, one solve; the Tour Viewer's votes
 * and keep-alive ticks, authoring plan 2026-09-28-0953 D18). Every reader
 * that recognised only the first silently lost the fixes inside a batch
 * (M2e/M2f milestone review #5). This helper is the one place that knows both
 * shapes, so each rule below is a reader's rule.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { recordedGpsEventPayloads } from './gps-event-actions';

const fix = (i: number) => ({
  odomPosition: [i, 0, 0],
  odomRotation: [0, 0, 0, 1],
  rawGpsPoint: {
    id: `gps-${String(i)}`,
    latitude: 50 + i * 1e-4,
    longitude: 8,
    timestamp: 1_700_000_000_000 + i,
  },
});

describe('recordedGpsEventPayloads', () => {
  it('a single recordGpsEvent carries its payload', () => {
    const payload = fix(1);
    expect(
      recordedGpsEventPayloads({ type: 'gpsData/recordGpsEvent', payload })
    ).toEqual([payload]);
  });

  it('a batch carries its events, in order', () => {
    const events = [fix(1), fix(2), fix(3)];
    expect(
      recordedGpsEventPayloads({
        type: 'gpsData/recordGpsEventBatch',
        payload: { events },
      })
    ).toEqual(events);
  });

  it('carries nothing for any other action, a missing payload, or a batch without an events list', () => {
    // A reader must never throw on a recording: these are a truncated or
    // foreign action file, read as "no GPS here".
    for (const action of [
      { type: 'gpsData/setZeroPos', payload: { lat: 1, lon: 2 } },
      { type: 'gpsData/recordGpsEvent' },
      { type: 'gpsData/recordGpsEventBatch' },
      { type: 'gpsData/recordGpsEventBatch', payload: { events: 'x' } },
      { type: 'gpsData/recordGpsEventBatch', payload: null },
      { payload: fix(1) },
      null,
      undefined,
      42,
    ]) {
      expect(recordedGpsEventPayloads(action)).toEqual([]);
    }
  });

  it('a sparse batch yields only its present entries (the core refuses it whole; a reader just skips the holes)', () => {
    // eslint-disable-next-line no-sparse-arrays -- the shape under test
    const events = [fix(1), , fix(3)];
    expect(
      recordedGpsEventPayloads({
        type: 'gpsData/recordGpsEventBatch',
        payload: { events },
      })
    ).toEqual([fix(1), fix(3)]);
  });

  it('property: a batch of n events reads as the n single actions it replaces', () => {
    // The equivalence every batch-aware reader rests on: whatever a reader
    // collects from one-by-one dispatches it collects from the batch.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), (n) => {
        const events = Array.from({ length: n }, (_, i) => fix(i));
        const single = events.flatMap((payload) =>
          recordedGpsEventPayloads({ type: 'gpsData/recordGpsEvent', payload })
        );
        expect(
          recordedGpsEventPayloads({
            type: 'gpsData/recordGpsEventBatch',
            payload: { events },
          })
        ).toEqual(single);
      })
    );
  });
});
