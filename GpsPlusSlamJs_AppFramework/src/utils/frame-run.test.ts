/**
 * Tests for one recorder run: the histogram, the attribution join and the
 * worst frames fed by one `endFrame` per frame, and the idle refresh
 * calibration (globe zoom performance plan 2026-10-03-2017, §4.1, PERF-0).
 *
 * Why this file matters: this is the object the globe lab's recorder
 * (PERF-1) calls every frame, so its parts must see the same frames with
 * the same indices; the export's "20 worst frames with their events" is
 * where the owner reads what was happening when a frame dropped.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  REFRESH_CALIBRATION_MIN_SAMPLES,
  calibrateRefreshInterval,
  createFrameRun,
} from './frame-run.js';

describe('createFrameRun', () => {
  it('feeds every part from one endFrame', () => {
    const r = createFrameRun();
    r.endFrame(16, []);
    r.endFrame(70, ['e-step']);
    r.endFrame(16);
    const s = r.summary();
    expect(s.stats.count).toBe(3);
    expect(s.attribution.frames).toBe(3);
    expect(s.attribution.hitchFrames).toEqual([1, 1, 0]);
    expect(s.worst[0]).toEqual({ frame: 1, ms: 70, events: ['e-step'] });
  });

  // The export carries `over` once and lets it stand for the join's hitch
  // frames too; that is only honest while the two always agree.
  it("agrees: the histogram's counts over each threshold are the join's hitch frames", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -5, max: 300 }), { maxLength: 200 }),
        (times) => {
          const r = createFrameRun();
          for (const ms of times) r.endFrame(ms, ['e']);
          const s = r.summary();
          expect(s.stats.over.map((o) => o.count)).toEqual(
            s.attribution.hitchFrames
          );
          expect(s.stats.count).toBe(s.attribution.frames);
          expect(s.stats.rejected).toBe(s.attribution.rejected);
        }
      )
    );
  });

  it('keeps the worst frames, slowest first, with their frame index', () => {
    const r = createFrameRun({ worstCount: 3 });
    const times = [16, 90, 17, 40, 120, 16, 55, 18];
    times.forEach((ms, i) => r.endFrame(ms, [`f${i}`]));
    expect(r.summary().worst).toEqual([
      { frame: 4, ms: 120, events: ['f4'] },
      { frame: 1, ms: 90, events: ['f1'] },
      { frame: 6, ms: 55, events: ['f6'] },
    ]);
  });

  // The frame index counts every call, so the lab's own frame numbering
  // and the export agree even when a bad interval is refused.
  it('numbers frames by call, including refused ones', () => {
    const r = createFrameRun({ worstCount: 1 });
    r.endFrame(Number.NaN, []);
    r.endFrame(80, []);
    expect(r.summary().worst[0]!.frame).toBe(1);
    expect(r.summary().stats.rejected).toBe(1);
  });

  it('keeps exactly the slowest `worstCount` frames (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 25 }),
        fc.array(fc.double({ min: 0, max: 500, noNaN: true }), {
          maxLength: 300,
        }),
        (worstCount, times) => {
          const r = createFrameRun({ worstCount });
          for (const ms of times) r.endFrame(ms, []);
          const got = r.summary().worst.map((w) => w.ms);
          const expected = [...times]
            .sort((a, b) => b - a)
            .slice(0, worstCount);
          expect(got).toEqual(expected);
        }
      )
    );
  });

  it('copies the events it keeps', () => {
    const r = createFrameRun({ worstCount: 1 });
    const events = ['load'];
    r.endFrame(90, events);
    events.push('mutated');
    expect(r.summary().worst[0]!.events).toEqual(['load']);
  });

  it('refuses a worstCount that is not a non-negative integer', () => {
    expect(() => createFrameRun({ worstCount: -1 })).toThrow(RangeError);
    expect(() => createFrameRun({ worstCount: 2.5 })).toThrow(RangeError);
  });
});

describe('calibrateRefreshInterval', () => {
  it('needs the declared minimum of samples', () => {
    expect(REFRESH_CALIBRATION_MIN_SAMPLES).toBe(30);
    expect(calibrateRefreshInterval(new Array(29).fill(16.7))).toBeNull();
    expect(calibrateRefreshInterval(new Array(30).fill(16.7))).toBe(16.7);
  });

  // The median ignores the few slow frames an idle page still has; swept
  // over the common phone and desktop refresh rates.
  it('returns the median interval at 60, 90, 120 and 144 Hz', () => {
    for (const hz of [60, 90, 120, 144]) {
      const period = 1000 / hz;
      const intervals = Array.from({ length: 120 }, (_, i) =>
        i % 40 === 0 ? 3 * period : period + ((i % 3) - 1) * 0.1
      );
      expect(calibrateRefreshInterval(intervals)).toBeCloseTo(period, 9);
    }
  });

  it('drops non-finite and non-positive intervals before counting', () => {
    const intervals = [...new Array(30).fill(8.3), Number.NaN, 0, -1];
    expect(calibrateRefreshInterval(intervals)).toBe(8.3);
    expect(
      calibrateRefreshInterval([...new Array(29).fill(8.3), Number.NaN])
    ).toBeNull();
  });

  it('takes another minimum, and refuses a bad one', () => {
    expect(calibrateRefreshInterval([10, 20, 30], 3)).toBe(20);
    expect(() => calibrateRefreshInterval([10], 0)).toThrow(RangeError);
  });
});
