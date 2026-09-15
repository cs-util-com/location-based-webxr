import { describe, it, expect } from 'vitest';
import {
  resolveLadder,
  runAlignmentTiming,
  type AlignmentTimingResult,
} from './alignment-timing-loop';

/**
 * The timing loop is the instrument the on-device figure comes out of, so
 * every one of its arithmetic and ordering rules is pinned here against a
 * FAKE library whose per-fix cost is known exactly. A fake is what makes the
 * assertions exact numbers instead of "it ran": the real solve's cost is the
 * quantity being measured and could never be asserted.
 *
 * The fake's cost model is deliberately HISTORY-DEPENDENT - fix `i` costs
 * `scale * (i + 1)` ticks - because that is the shape the real solve has, and
 * it is the only shape under which a mean-per-fix bug is distinguishable from
 * the marginal-per-fix figure the live app actually pays.
 */

interface FakeHarness {
  readonly now: () => number;
  readonly createPass: (armId: string) => (fixIndex: number) => void;
  /** `armId` of every pass, in the order the loop ran them. */
  readonly passLog: string[];
  /** Fix indices seen by the most recent pass, to prove runs start empty. */
  readonly lastPassIndices: number[];
}

/**
 * @param armScale per-arm cost multiplier
 * @param passScale per-pass multiplier, indexed by pass ordinal (warm-ups
 *   first); missing entries default to 1. This is how a repeat is made
 *   cheaper or dearer than its neighbours so median and minimum can differ.
 */
function makeFake(
  armScale: Readonly<Record<string, number>>,
  passScale: readonly number[] = []
): FakeHarness {
  let clock = 0;
  const passOrdinalPerArm = new Map<string, number>();
  const passLog: string[] = [];
  const lastPassIndices: number[] = [];
  return {
    now: () => clock,
    passLog,
    lastPassIndices,
    createPass(armId: string) {
      const ordinal = passOrdinalPerArm.get(armId) ?? 0;
      passOrdinalPerArm.set(armId, ordinal + 1);
      passLog.push(armId);
      lastPassIndices.length = 0;
      const scale = (armScale[armId] ?? 1) * (passScale[ordinal] ?? 1);
      return (fixIndex: number) => {
        lastPassIndices.push(fixIndex);
        clock += scale * (fixIndex + 1);
      };
    },
  };
}

/** The exact cost of applying fixes `from+1 .. to` under the fake, in ticks. */
function fakeSegmentCost(scale: number, from: number, to: number): number {
  return (scale * ((from + to + 1) * (to - from))) / 2;
}

function segmentOf(
  result: AlignmentTimingResult,
  armId: string,
  toHistory: number
) {
  const arm = result.arms.find((a) => a.armId === armId);
  expect(arm, `arm ${armId} missing from the result`).toBeDefined();
  const segment = arm?.segments.find((s) => s.toHistory === toHistory);
  expect(segment, `segment ending at ${toHistory} missing`).toBeDefined();
  return segment!;
}

describe('resolveLadder', () => {
  // Why this matters: a rung at or above the recording's fix count would be
  // the SAME history length as the final rung wearing a different label, and
  // two identical columns read as an agreement between two measurements.
  it('drops rungs at or above the fix count and ends at the full history', () => {
    expect(resolveLadder([50, 100, 200, 400], 300)).toEqual([
      50, 100, 200, 300,
    ]);
    expect(resolveLadder([50, 100], 100)).toEqual([50, 100]);
    expect(resolveLadder([50, 100, 200], 40)).toEqual([40]);
  });

  // Why this matters: the ladder is page-authored data; an unsorted or
  // duplicated entry would silently produce a negative or zero-width segment.
  it('sorts and de-duplicates', () => {
    expect(resolveLadder([200, 50, 50, 100], 1000)).toEqual([
      50, 100, 200, 1000,
    ]);
  });

  it('rejects a non-positive fix count or a malformed rung', () => {
    expect(() => resolveLadder([50], 0)).toThrow(RangeError);
    expect(() => resolveLadder([50.5], 100)).toThrow(RangeError);
    expect(() => resolveLadder([0], 100)).toThrow(RangeError);
  });
});

describe('runAlignmentTiming', () => {
  const baseOptions = {
    fixCount: 8,
    ladder: [4],
    repeats: 1,
    warmups: 0,
  };

  // Why this matters: the desktop census's first run measured each arm's whole
  // ladder back to back and read the machine's load as if it were the
  // configuration - the correction moved its noise floor from ±37 % to ±5 %.
  // Interleaving is therefore a correctness property of this loop, not a style
  // choice, and nothing else in the suite can observe it.
  it('interleaves the arms within every pass, warm-ups included', async () => {
    const fake = makeFake({ a: 1, b: 1 });
    await runAlignmentTiming({
      ...baseOptions,
      armIds: ['a', 'b'],
      repeats: 2,
      warmups: 1,
      createPass: fake.createPass,
      now: fake.now,
    });
    expect(fake.passLog).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
  });

  // Why this matters: the cost grows with stored history, so a store reused
  // between passes would measure a history that never resets and every repeat
  // after the first would be dearer than the app could ever pay.
  it('asks for a fresh pass per arm per repeat and always starts at fix 0', async () => {
    const fake = makeFake({ a: 1 });
    await runAlignmentTiming({
      ...baseOptions,
      armIds: ['a'],
      repeats: 3,
      warmups: 1,
      createPass: fake.createPass,
      now: fake.now,
    });
    expect(fake.passLog).toHaveLength(4);
    expect(fake.lastPassIndices[0]).toBe(0);
    expect(fake.lastPassIndices).toHaveLength(8);
  });

  // Why this matters: the census measured the discarded first walk at +137 %
  // on a small cell. Including it would inflate every figure; hiding it
  // entirely would stop the reader from seeing how large the discard was.
  it('excludes warm-up passes from the statistics and still reports them', async () => {
    const fake = makeFake({ a: 1 }, [10, 1, 1, 1]);
    const result = await runAlignmentTiming({
      ...baseOptions,
      armIds: ['a'],
      repeats: 3,
      warmups: 1,
      createPass: fake.createPass,
      now: fake.now,
    });
    const arm = result.arms[0]!;
    const cleanTotal = fakeSegmentCost(1, 0, 8);
    expect(arm.warmupTotalMs).toEqual([cleanTotal * 10]);
    expect(arm.totalMsPerRepeat).toEqual([cleanTotal, cleanTotal, cleanTotal]);
    expect(arm.totalMedianMs).toBe(cleanTotal);
    expect(arm.totalMinMs).toBe(cleanTotal);
  });

  // Why this matters: this is the mistake the desktop census had to correct
  // mid-run. `total / N` is the MEAN over a history growing from 1 to N -
  // about half of what the live app pays for its next fix. With the fake's
  // linear cost the two differ by a factor of two on the first segment, so a
  // regression to the mean fails loudly here.
  it('reports the marginal cost of each segment, not the mean over the walk', async () => {
    const fake = makeFake({ a: 1 });
    const result = await runAlignmentTiming({
      ...baseOptions,
      fixCount: 8,
      ladder: [4],
      armIds: ['a'],
      createPass: fake.createPass,
      now: fake.now,
    });
    const first = segmentOf(result, 'a', 4);
    const second = segmentOf(result, 'a', 8);
    // Fixes 1..4 cost 1+2+3+4 = 10 ticks over 4 fixes.
    expect(first.medianMsPerFix).toBe(10 / 4);
    expect(first.fromHistory).toBe(0);
    expect(first.midHistory).toBe(2);
    // Fixes 5..8 cost 5+6+7+8 = 26 ticks over 4 fixes - the growth the whole
    // measurement exists to show.
    expect(second.medianMsPerFix).toBe(26 / 4);
    expect(second.fromHistory).toBe(4);
    expect(second.midHistory).toBe(6);
    // The mean over the whole walk would be 36/8 = 4.5 - neither of the above.
    expect(result.arms[0]!.totalMedianMs / 8).toBe(4.5);
  });

  // Why this matters: an even repeat count is the case a "middle element"
  // implementation gets wrong, and 3/5/9 are not the only counts a reader can
  // reach - the JSON carries every repeat, so someone will recompute.
  it('takes the median across repeats, averaging the two middle ones when even', async () => {
    const fake = makeFake({ a: 1 }, [1, 2, 3, 4]);
    const result = await runAlignmentTiming({
      ...baseOptions,
      armIds: ['a'],
      repeats: 4,
      warmups: 0,
      createPass: fake.createPass,
      now: fake.now,
    });
    const segment = segmentOf(result, 'a', 4);
    const unit = 10 / 4;
    expect(segment.msPerFixPerRepeat).toEqual([
      unit,
      unit * 2,
      unit * 3,
      unit * 4,
    ]);
    expect(segment.medianMsPerFix).toBe((unit * 2 + unit * 3) / 2);
    expect(segment.minMsPerFix).toBe(unit);
  });

  // Why this matters: under contention the minimum is the least-contaminated
  // estimate of the cost on an idle device - the census quotes it for exactly
  // that reason - so it must be the smallest KEPT repeat and never the warm-up.
  it('takes the minimum from the kept repeats only', async () => {
    const fake = makeFake({ a: 1 }, [0.1, 3, 2]);
    const result = await runAlignmentTiming({
      ...baseOptions,
      armIds: ['a'],
      repeats: 2,
      warmups: 1,
      createPass: fake.createPass,
      now: fake.now,
    });
    const segment = segmentOf(result, 'a', 4);
    expect(segment.minMsPerFix).toBe((10 / 4) * 2);
  });

  // Why this matters: the arms exist to be compared with each other, so a
  // per-arm mix-up would invert the whole reading while every total stayed
  // plausible.
  it('keeps each arm on its own clock', async () => {
    const fake = makeFake({ shipped: 1, w180: 0.5 });
    const result = await runAlignmentTiming({
      ...baseOptions,
      armIds: ['shipped', 'w180'],
      createPass: fake.createPass,
      now: fake.now,
    });
    expect(segmentOf(result, 'shipped', 8).medianMsPerFix).toBe(26 / 4);
    expect(segmentOf(result, 'w180', 8).medianMsPerFix).toBe(13 / 4);
  });

  // Why this matters: the page runs for minutes on a phone; without a progress
  // signal the owner cannot tell a slow run from a hung one, and the loop must
  // hand the UI thread back between passes or the page stops repainting.
  it('reports progress and yields between passes', async () => {
    const fake = makeFake({ a: 1, b: 1 });
    const progress: string[] = [];
    let yields = 0;
    await runAlignmentTiming({
      ...baseOptions,
      armIds: ['a', 'b'],
      repeats: 1,
      warmups: 1,
      createPass: fake.createPass,
      now: fake.now,
      onProgress: (p) => progress.push(`${p.completedPasses}/${p.totalPasses}`),
      yieldControl: () => {
        yields += 1;
        return Promise.resolve();
      },
    });
    expect(progress).toEqual(['1/4', '2/4', '3/4', '4/4']);
    expect(yields).toBe(4);
  });

  // Why this matters: every figure the page prints is only meaningful beside
  // the parameters it was taken under - that is the standing rule for any
  // measurement here, and the JSON blob is what leaves the device.
  it('echoes the parameters it ran under', async () => {
    const fake = makeFake({ a: 1 });
    const result = await runAlignmentTiming({
      ...baseOptions,
      fixCount: 300,
      ladder: [50, 100, 200, 400],
      armIds: ['a'],
      repeats: 3,
      warmups: 1,
      createPass: fake.createPass,
      now: fake.now,
    });
    expect(result.parameters).toEqual({
      fixCount: 300,
      ladder: [50, 100, 200, 300],
      repeats: 3,
      warmups: 1,
    });
  });

  // Why this matters: these are module-boundary inputs assembled from page
  // state; a silent clamp would produce a report whose header does not
  // describe the run that produced it.
  it('rejects malformed parameters instead of clamping them', async () => {
    const fake = makeFake({ a: 1 });
    const ok = {
      ...baseOptions,
      armIds: ['a'],
      createPass: fake.createPass,
      now: fake.now,
    };
    await expect(runAlignmentTiming({ ...ok, repeats: 0 })).rejects.toThrow(
      RangeError
    );
    await expect(runAlignmentTiming({ ...ok, warmups: -1 })).rejects.toThrow(
      RangeError
    );
    await expect(runAlignmentTiming({ ...ok, armIds: [] })).rejects.toThrow(
      RangeError
    );
    await expect(
      runAlignmentTiming({ ...ok, armIds: ['a', 'a'] })
    ).rejects.toThrow(RangeError);
    await expect(runAlignmentTiming({ ...ok, fixCount: 0 })).rejects.toThrow(
      RangeError
    );
  });
});
