/**
 * The 3D views' frame clock: the intervals between their last frames
 * (the readout's mean and worst) and the frames over 50 ms of the last
 * five seconds (the Performance tab's badge). One clock per view, ticked
 * once per drawn frame, and told when its frames stop (`pause`: a hidden
 * page, a canvas without a size), so the gap after a pause is not taken
 * for a slow frame while a real hitch, however long, still is.
 *
 * @see frame-clock.ts.md
 */

import { FRAMES_STOPPED_EVENT } from "../editor/browser-question.js";

/** A frame longer than this (ms) is slow: under 20 frames a second. */
export const SLOW_FRAME_MS = 50;

/** How long a slow frame is counted after it (ms). */
const SLOW_WINDOW_MS = 5_000;

export interface FrameClock {
  /** A frame was drawn at `now` (ms, the frame loop's clock). */
  tick(now: number): void;
  /** The frames stopped (a hidden page, a canvas without a size): the
   *  gap up to the next tick is not timed, and the clock starts again
   *  from that frame. */
  pause(): void;
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
      if (last !== null) {
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
    pause() {
      last = null;
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

/** What `pauseWhenHidden` listens to: the page's document. */
interface VisiblePage {
  readonly hidden: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Pauses `clock` whenever `page` is hidden (the browser draws no frames
 *  for a hidden tab) and after each of its questions
 *  (`../editor/browser-question.ts`); returns the function that stops listening. */
export function pauseWhenHidden(
  clock: Pick<FrameClock, "pause">,
  page: VisiblePage = document,
): () => void {
  const onChange = () => {
    if (page.hidden) clock.pause();
  };
  const onStopped = () => {
    clock.pause();
  };
  page.addEventListener("visibilitychange", onChange);
  page.addEventListener(FRAMES_STOPPED_EVENT, onStopped);
  return () => {
    page.removeEventListener("visibilitychange", onChange);
    page.removeEventListener(FRAMES_STOPPED_EVENT, onStopped);
  };
}
