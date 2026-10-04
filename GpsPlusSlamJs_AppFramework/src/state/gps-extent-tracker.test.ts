import { describe, expect, it } from 'vitest';
import {
  createGpsExtentTracker,
  type GpsExtentPoint,
} from './gps-extent-tracker.js';

let nextId = 0;
/** A device fix at north `n`, east `e` (NUE metres from the session zero). */
function fix(n: number, e: number, source?: string): GpsExtentPoint {
  nextId += 1;
  return {
    id: `gps-${String(nextId)}`,
    timestamp: 1_000 * nextId,
    coordinates: [n, 400 + nextId, e],
    ...(source === undefined ? {} : { source }),
  };
}

describe('createGpsExtentTracker', () => {
  // Why this test matters: the extent is what decides whether the QR mint's
  // alignment can see a heading at all (the mint's maturity floor and the
  // uncertain-heading marker both read it). It is the largest HORIZONTAL
  // distance between two fixes: height is not a baseline for yaw.
  it('is the largest horizontal distance between two fixes, height ignored', () => {
    const tracker = createGpsExtentTracker();
    expect(tracker.update([])).toBe(0);
    expect(tracker.update([fix(0, 0)])).toBe(0);
    const list = [fix(0, 0), fix(3, 4), fix(-1, 1)];
    expect(tracker.update(list)).toBeCloseTo(5, 9);
  });

  // Why this test matters: a scanned code's synthetic GPS votes are
  // re-projections of an older code's anchor, not a walk; counting them
  // would let a code mature on evidence nobody walked (the same rule the
  // session metadata's coverage index and the mint's sample count apply).
  it('counts device fixes only, and never rounds an unknown stamp to device', () => {
    const tracker = createGpsExtentTracker();
    const list = [
      fix(0, 0),
      fix(30, 0, 'synthetic-qr'),
      fix(0, 50, 'some-future-source'),
      fix(0, 2, 'device'),
    ];
    expect(tracker.update(list)).toBeCloseTo(2, 9);
  });

  // Why this test matters: the tracker is called on every animation frame
  // with the store's growing list; it must fold only the new tail and still
  // give the same answer as a from-scratch pass.
  it('folds an appended list incrementally', () => {
    const tracker = createGpsExtentTracker();
    const list = [fix(0, 0), fix(1, 0)];
    expect(tracker.update(list)).toBeCloseTo(1, 9);
    list.push(fix(0, 7));
    expect(tracker.update(list)).toBeCloseTo(Math.hypot(1, 7), 9);
    expect(tracker.update(list)).toBeCloseTo(Math.hypot(1, 7), 9);
  });

  // Why this test matters: a Start Recording store swap or a tracking
  // restart empties the list, and the new alignment rests on the new fixes
  // only; a stale extent would mature a code on a walk the alignment never
  // saw.
  it('starts over when the list shrinks or is replaced by another one', () => {
    const tracker = createGpsExtentTracker();
    expect(tracker.update([fix(0, 0), fix(40, 0)])).toBeCloseTo(40, 9);
    expect(tracker.update([])).toBe(0);
    const longer = [fix(0, 0), fix(0, 1), fix(0, 2)];
    expect(tracker.update(longer)).toBeCloseTo(2, 9);
    // Same length or longer, but a different first fix: another list.
    const other = [fix(5, 5), fix(5, 6), fix(5, 7), fix(5, 8)];
    expect(tracker.update(other)).toBeCloseTo(3, 9);
  });

  // Why this test matters: GPS points are external data; a non-finite
  // coordinate must not poison the extent into NaN for the rest of the
  // session (NaN compares false against every floor, so the code would never
  // mature).
  it('skips a fix with a non-finite coordinate', () => {
    const tracker = createGpsExtentTracker();
    const bad: GpsExtentPoint = {
      id: 'bad',
      timestamp: 1,
      coordinates: [Number.NaN, 0, 0],
    };
    expect(tracker.update([fix(0, 0), bad, fix(0, 3)])).toBeCloseTo(3, 9);
  });

  // Why this test matters: the Tour Viewer folds the extent on every store
  // change (the authoring settle's maturity, D33), and a GPS list is
  // external data: a fix without coordinates (an older stored shape, a
  // partial record) must be skipped, never throw out of a store listener.
  it('skips a fix without coordinates instead of throwing', () => {
    const tracker = createGpsExtentTracker();
    const shapeless = { id: 'old', timestamp: 2 } as unknown as GpsExtentPoint;
    expect(tracker.update([fix(0, 0), shapeless, fix(0, 4)])).toBeCloseTo(4, 9);
  });
});
