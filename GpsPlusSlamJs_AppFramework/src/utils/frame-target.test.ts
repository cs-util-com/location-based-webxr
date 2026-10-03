/**
 * Tests for the owner's frame target (DEC-PERF-3, globe zoom performance
 * plan 2026-10-03-2017 §12).
 *
 * Why this file matters: the page prints PASS or FAIL from this check, and
 * the owner decides whether PERF-2's fixes are enough from that word. The
 * target is "no frame over 50 ms and at most 5 over 33 ms" in a warm run;
 * "a handful" is also reported at 3 and 10 so the owner sees how close the
 * result is to the line.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  FRAME_TARGET,
  FRAME_TARGET_HANDFULS,
  checkFrameTarget,
} from './frame-target.js';

const over = (o33: number, o50: number, o100 = 0) => [
  { thresholdMs: 33, count: o33 },
  { thresholdMs: 50, count: o50 },
  { thresholdMs: 100, count: o100 },
];

describe('checkFrameTarget', () => {
  it('declares DEC-PERF-3: none over 50 ms, at most 5 over 33 ms, handfuls 3/5/10', () => {
    expect(FRAME_TARGET).toEqual({ hardMs: 50, softMs: 33, softAllowed: 5 });
    expect(FRAME_TARGET_HANDFULS).toEqual([3, 5, 10]);
  });

  it('passes at the line and fails one past it', () => {
    expect(checkFrameTarget(over(5, 0)).pass).toBe(true);
    expect(checkFrameTarget(over(6, 0)).pass).toBe(false);
    expect(checkFrameTarget(over(1, 1)).pass).toBe(false);
  });

  it('reports the counts it decided on', () => {
    const v = checkFrameTarget(over(4, 0, 0));
    expect(v.overHard).toBe(0);
    expect(v.overSoft).toBe(4);
    expect(v.target).toEqual(FRAME_TARGET);
  });

  // The handful is swept: 4 over 33 ms passes at 5 and 10 but not at 3.
  it('reports the verdict at every handful', () => {
    expect(checkFrameTarget(over(4, 0)).handfuls).toEqual([
      { allowed: 3, pass: false },
      { allowed: 5, pass: true },
      { allowed: 10, pass: true },
    ]);
    // A frame over 50 ms fails every handful.
    expect(checkFrameTarget(over(0, 1)).handfuls.every((h) => !h.pass)).toBe(
      true
    );
  });

  it('agrees with its handful at the decided value, and is monotone in it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 3 }),
        (soft, hard) => {
          const v = checkFrameTarget(over(soft + hard, hard));
          const at5 = v.handfuls.find((h) => h.allowed === 5)!;
          const passes = v.handfuls.map((h) => h.pass);
          // Once it passes at a smaller handful it passes at every larger one.
          const monotone = passes.every(
            (p, i) => i === 0 || p || !passes[i - 1]
          );
          expect(at5.pass).toBe(v.pass);
          expect(monotone).toBe(true);
        }
      )
    );
  });

  // A target whose thresholds were never counted would otherwise read as
  // zero frames over them: a silent PASS.
  it('refuses counts that do not include the target thresholds', () => {
    expect(() => checkFrameTarget([{ thresholdMs: 33, count: 0 }])).toThrow(
      RangeError
    );
  });

  it('takes another target and other handfuls', () => {
    const v = checkFrameTarget(
      [
        { thresholdMs: 20, count: 2 },
        { thresholdMs: 40, count: 0 },
      ],
      { hardMs: 40, softMs: 20, softAllowed: 1 },
      [0, 2]
    );
    expect(v.pass).toBe(false);
    expect(v.handfuls).toEqual([
      { allowed: 0, pass: false },
      { allowed: 2, pass: true },
    ]);
  });

  it('refuses a malformed target', () => {
    expect(() =>
      checkFrameTarget(over(0, 0), { hardMs: 50, softMs: 33, softAllowed: -1 })
    ).toThrow(RangeError);
    expect(() =>
      checkFrameTarget(over(0, 0), { hardMs: 50, softMs: 33, softAllowed: 1.5 })
    ).toThrow(RangeError);
  });
});
