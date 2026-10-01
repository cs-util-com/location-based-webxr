import { describe, it, expect } from 'vitest';
import type { RecordedAction } from 'gps-plus-slam-app-framework/storage/zip-reader';
import { planTimingReplay, createPassFactory } from './alignment-timing-run';
import type { TimingArm } from './alignment-timing-arms';
import { validateLicenseKey } from 'gps-plus-slam-app-framework/core';
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-app-framework/licensing';

// The library gates its action creators on an active license; the app
// activates the bundled community key when it builds its store, and a fake
// store cannot. Same preamble as the other recorder suites that touch
// library actions.
validateLicenseKey(COMMUNITY_LICENSE_KEY);

function fix(timestamp: number, id = 'f'): RecordedAction {
  return {
    type: 'gpsData/recordGpsEvent',
    payload: { id, rawGpsPoint: { latitude: 1, longitude: 2, timestamp } },
  };
}
const zero: RecordedAction = {
  type: 'gpsData/setZeroPos',
  payload: { latitude: 1, longitude: 2 },
};

describe('planTimingReplay', () => {
  // Why this test matters: a recording carries compass opt-ins, frame
  // captures, depth samples and ref points. Replaying those would let the
  // RECORDING reconfigure the solve - a walk captured with a compass override
  // on would silently measure a different configuration than one captured
  // without it, and the arms would stop being comparable. Only the session
  // zero and the fixes are replayed, and that is a load-bearing choice.
  it('keeps only the session zero and the GPS fixes, in order', () => {
    const plan = planTimingReplay([
      { type: 'recording/startSession', payload: { startTime: 1 } },
      zero,
      { type: 'gpsData/setColdStartOverrideEnabled', payload: true },
      fix(1000, 'a'),
      { type: 'gpsData/add2dImage', payload: {} },
      fix(2000, 'b'),
    ]);
    expect(plan.fixCount).toBe(2);
    expect(plan.preamble).toEqual([zero]);
    expect(plan.groups).toEqual([[fix(1000, 'a')], [fix(2000, 'b')]]);
  });

  // Why this test matters: the solve does not run before a session zero
  // exists, so the zero must be dispatched OUTSIDE the timed span - otherwise
  // the first fix of every pass carries a one-off cost that belongs to no fix.
  it('puts everything before the first fix into the untimed preamble', () => {
    const plan = planTimingReplay([zero, zero, fix(1000)]);
    expect(plan.preamble).toEqual([zero, zero]);
    expect(plan.groups).toHaveLength(1);
  });

  // Why this test matters: a re-zero mid-session is rare but real, and
  // dropping it (or hoisting it to the front) would replay the rest of the
  // walk against the wrong origin. It rides with the fix that follows it so
  // the order of the recorded stream is preserved exactly.
  it('keeps a mid-stream zero with the fix that follows it', () => {
    const plan = planTimingReplay([zero, fix(1000, 'a'), zero, fix(2000, 'b')]);
    expect(plan.groups).toEqual([[fix(1000, 'a')], [zero, fix(2000, 'b')]]);
  });

  // Why this test matters: the duration is what turns "0.3 ms per fix" into
  // "per fix at 1.9 Hz", which is the form a budget is read in.
  it('derives the replayed span from the fix timestamps, and tolerates their absence', () => {
    expect(
      planTimingReplay([zero, fix(1000), fix(251_000)]).durationSeconds
    ).toBe(250);
    expect(
      planTimingReplay([zero, { type: 'gpsData/recordGpsEvent', payload: {} }])
        .durationSeconds
    ).toBeNull();
  });

  // Why this test matters: a recording with no fixes cannot be measured, and
  // the failure must be a clear refusal rather than a table of zeros.
  it('reports an empty recording as zero fixes rather than inventing one', () => {
    const plan = planTimingReplay([zero]);
    expect(plan.fixCount).toBe(0);
    expect(plan.groups).toEqual([]);
  });

  // Why this test matters (core 1.26; Tour Viewer authoring plan
  // 2026-09-28-0953 D18): a Tour Viewer recording carries its device fixes
  // together with the code keep-alive's ring as ONE `recordGpsEventBatch`,
  // and that dispatch IS the solve the timing page exists to measure.
  // Dropped as "not a fix", such a recording timed only its lone fixes and
  // its span ended early - the dearest solves silently missing.
  it('times a recordGpsEventBatch as one unit - one dispatch, one solve - in recorded order', () => {
    const batch: RecordedAction = {
      type: 'gpsData/recordGpsEventBatch',
      payload: {
        events: [fix(2000, 'b').payload, fix(2000, 'ring').payload],
      },
    };
    const plan = planTimingReplay([zero, fix(1000, 'a'), batch, fix(3000)]);
    expect(plan.fixCount).toBe(3);
    expect(plan.groups).toEqual([[fix(1000, 'a')], [batch], [fix(3000)]]);
    expect(planTimingReplay([zero, fix(1000), batch]).durationSeconds).toBe(1);
  });
});

describe('createPassFactory', () => {
  const arms: readonly TimingArm[] = [
    { id: 'shipped', label: 'shipped', overrides: null },
    { id: 'exp3', label: 'exp 3', overrides: { gpsAccuracyExponent: 3 } },
  ];

  function fakeStores() {
    const created: { overrides: unknown; dispatched: string[] }[] = [];
    const createStore = () => {
      const record = {
        overrides: undefined as unknown,
        dispatched: [] as string[],
      };
      created.push(record);
      return {
        dispatch: (action: { type: string; payload?: unknown }) => {
          if (action.type === 'gpsData/setAlignmentOverrides') {
            record.overrides = action.payload;
          }
          record.dispatched.push(action.type);
        },
      };
    };
    return { created, createStore };
  }

  // Why this test matters: `setAlignmentOverrides` REPLACES rather than
  // merges, so each arm must be applied to a store that has had nothing else
  // applied to it. A shared store would leave the previous arm's window in
  // place and the two columns would measure the same thing.
  it(`builds a fresh store per pass and applies that arm's overrides first`, () => {
    const { created, createStore } = fakeStores();
    const plan = planTimingReplay([zero, fix(1000)]);
    const factory = createPassFactory({ plan, arms, createStore });
    factory('exp3');
    factory('shipped');
    expect(created).toHaveLength(2);
    expect(created[0]?.overrides).toEqual({ gpsAccuracyExponent: 3 });
    expect(created[1]?.overrides).toBeNull();
    // The overrides land before the session zero, which lands before any fix.
    expect(created[0]?.dispatched).toEqual([
      'gpsData/setAlignmentOverrides',
      'gpsData/setZeroPos',
    ]);
  });

  // Why this test matters: the timed unit must be the per-fix dispatch the
  // live app makes and nothing else. If the preamble were inside it, the
  // measured cost of fix 0 would include work the app does once per session.
  it(`dispatches exactly the fix's own group when the fix is applied`, () => {
    const { created, createStore } = fakeStores();
    const plan = planTimingReplay([zero, fix(1000, 'a'), zero, fix(2000, 'b')]);
    const applyFix = createPassFactory({ plan, arms, createStore })('shipped');
    applyFix(0);
    expect(created[0]?.dispatched).toEqual([
      'gpsData/setAlignmentOverrides',
      'gpsData/setZeroPos',
      'gpsData/recordGpsEvent',
    ]);
    applyFix(1);
    expect(created[0]?.dispatched.slice(3)).toEqual([
      'gpsData/setZeroPos',
      'gpsData/recordGpsEvent',
    ]);
  });

  it('refuses an unknown arm id and an out-of-range fix index', () => {
    const { createStore } = fakeStores();
    const plan = planTimingReplay([zero, fix(1000)]);
    const factory = createPassFactory({ plan, arms, createStore });
    expect(() => factory('nope')).toThrow(/nope/);
    expect(() => factory('shipped')(1)).toThrow(RangeError);
  });
});
