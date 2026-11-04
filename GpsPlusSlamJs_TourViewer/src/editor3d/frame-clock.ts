/**
 * The 3D views' frame clock: the intervals between their last frames
 * (the readout's mean and worst) and the frames over 50 ms of the last
 * five seconds (the Performance tab's badge). One clock per view, ticked
 * once per drawn frame.
 *
 * @see frame-clock.ts.md
 */

/** A frame longer than this (ms) is slow: under 20 frames a second. */
export const SLOW_FRAME_MS = 50;

/** How long a slow frame is counted after it (ms). */
const SLOW_WINDOW_MS = 5_000;

/** A gap longer than this (ms) is a pause (a hidden tab, a stopped
 *  loop), not a frame: not timed, and the clock starts again. */
const PAUSE_MS = 1_000;

export interface FrameClock {
  /** A frame was drawn at `now` (ms, the frame loop's clock). */
  tick(now: number): void;
  /** The mean of the intervals kept (ms); 0 before the second frame. */
  meanMs(): number;
  /** The longest of them (ms); 0 before the second frame. */
  worstMs(): number;
  /** The frames over `SLOW_FRAME_MS` in the `SLOW_WINDOW_MS` up to the
   *  last frame. */
  slowFrames(): number;
  /** The intervals kept, oldest first (a copy). */
  recentMs(): number[];
  /** How many intervals were ever timed: the shell takes the new ones
   *  of `recentMs` by it. */
  count(): number;
}

/** A clock keeping the last `keep` intervals (60 by default). */
export function createFrameClock(keep = 60): FrameClock {
  const intervals: number[] = [];
  /** When each slow frame of the window ended. */
  const slowAt: number[] = [];
  let last: number | null = null;
  let timed = 0;
  return {
    tick(now) {
      if (last !== null && now - last <= PAUSE_MS) {
        const gap = now - last;
        intervals.push(gap);
        timed += 1;
        if (intervals.length > keep) intervals.shift();
        if (gap > SLOW_FRAME_MS) slowAt.push(now);
      }
      last = now;
      while (slowAt.length > 0 && now - (slowAt[0] ?? now) > SLOW_WINDOW_MS) {
        slowAt.shift();
      }
    },
    meanMs() {
      return intervals.length === 0
        ? 0
        : intervals.reduce((a, b) => a + b, 0) / intervals.length;
    },
    worstMs() {
      return intervals.length === 0 ? 0 : Math.max(...intervals);
    },
    slowFrames() {
      return slowAt.length;
    },
    recentMs() {
      return [...intervals];
    },
    count() {
      return timed;
    },
  };
}
