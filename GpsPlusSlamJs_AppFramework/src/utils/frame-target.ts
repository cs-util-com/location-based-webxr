/**
 * The owner's frame target, checked from a run's exact threshold counts
 * (DEC-PERF-3; globe zoom performance plan 2026-10-03-2017, §4.1 and §12).
 *
 * @see frame-target.ts.md
 */

import type { FrameOverCount } from './frame-histogram.js';

/** A frame target: no interval over `hardMs`, at most `softAllowed` over `softMs`. */
export interface FrameTarget {
  readonly hardMs: number;
  readonly softMs: number;
  readonly softAllowed: number;
}

/**
 * DEC-PERF-3 (owner, 2026-10-03): in a warm run of the scripted zoom on the
 * owner's phone, no frame over 50 ms and at most 5 over 33 ms.
 */
export const FRAME_TARGET: FrameTarget = {
  hardMs: 50,
  softMs: 33,
  softAllowed: 5,
};

/** "A handful" is decided at 5 and also reported at 3 and 10 (DEC-PERF-3). */
export const FRAME_TARGET_HANDFULS: readonly number[] = [3, 5, 10];

export interface FrameTargetVerdict {
  readonly pass: boolean;
  /** Intervals over `target.hardMs`. */
  readonly overHard: number;
  /** Intervals over `target.softMs`. */
  readonly overSoft: number;
  readonly target: FrameTarget;
  /** The same check with `softAllowed` replaced by each handful, in the order given. */
  readonly handfuls: readonly {
    readonly allowed: number;
    readonly pass: boolean;
  }[];
}

const isCount = (n: number) => Number.isInteger(n) && n >= 0;

function countAt(over: readonly FrameOverCount[], thresholdMs: number): number {
  const hit = over.find((o) => o.thresholdMs === thresholdMs);
  if (hit === undefined) {
    throw new RangeError(
      `no count at ${thresholdMs} ms; the run counted ${over.map((o) => o.thresholdMs).join(', ') || 'nothing'}`
    );
  }
  return hit.count;
}

/**
 * Checks a run's exact counts (`FrameHistogramSnapshot.over`) against a
 * target.
 *
 * @throws RangeError when the counts do not include the target's two
 *   thresholds (an uncounted threshold would read as zero frames over it,
 *   a silent PASS), or when `softAllowed` or a handful is not a
 *   non-negative integer.
 */
export function checkFrameTarget(
  over: readonly FrameOverCount[],
  target: FrameTarget = FRAME_TARGET,
  handfuls: readonly number[] = FRAME_TARGET_HANDFULS
): FrameTargetVerdict {
  for (const allowed of [target.softAllowed, ...handfuls]) {
    if (!isCount(allowed)) {
      throw new RangeError(
        `an allowed count must be a non-negative integer, got ${String(allowed)}`
      );
    }
  }
  const overHard = countAt(over, target.hardMs);
  const overSoft = countAt(over, target.softMs);
  const passWith = (allowed: number) => overHard === 0 && overSoft <= allowed;
  return {
    pass: passWith(target.softAllowed),
    overHard,
    overSoft,
    target,
    handfuls: handfuls.map((allowed) => ({ allowed, pass: passWith(allowed) })),
  };
}
