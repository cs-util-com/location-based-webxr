/**
 * Why these tests matter: both 3D views time their frames for the
 * editor's Performance tab, and its badge counts the slow frames of the
 * last five seconds. A clock that kept every frame would grow without
 * bound; one that counted a slow frame forever would keep the badge up
 * after the view has recovered; and the mean must stay what the readout
 * has always shown (the last 60 intervals).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createFrameClock,
  pauseWhenHidden,
  SLOW_FRAME_MS,
} from "./frame-clock.js";
import { confirmPausingFrames } from "../editor/browser-question.js";

/** A clock that ticked at each of `times` (ms). */
function ticked(times: readonly number[], keep?: number) {
  const clock = createFrameClock(keep);
  for (const t of times) clock.tick(t);
  return clock;
}

describe("createFrameClock", () => {
  it("knows nothing before its second frame", () => {
    const clock = ticked([100]);
    expect(clock.meanMs()).toBe(0);
    expect(clock.worstMs()).toBe(0);
    expect(clock.slowFrames()).toBe(0);
    expect(clock.recentMs()).toEqual([]);
  });

  it("gives the mean and the worst of the intervals kept", () => {
    const clock = ticked([0, 16, 32, 92]);
    expect(clock.recentMs()).toEqual([16, 16, 60]);
    expect(clock.meanMs()).toBeCloseTo(92 / 3, 9);
    expect(clock.worstMs()).toBe(60);
    expect(clock.count()).toBe(3);
  });

  it("keeps only the last `keep` intervals", () => {
    const clock = ticked([0, 100, 110, 120], 2);
    expect(clock.recentMs()).toEqual([10, 10]);
    expect(clock.count()).toBe(3);
    expect(clock.worstMs()).toBe(10);
  });

  it("counts a frame over 50 ms as slow for five seconds after it", () => {
    const clock = ticked([0, 16, 16 + SLOW_FRAME_MS + 1, 100]);
    expect(clock.slowFrames()).toBe(1);
    for (let t = 116; t < 5_000; t += 16) clock.tick(t);
    expect(clock.slowFrames()).toBe(1);
    for (let t = 5_000; t < 5_200; t += 16) clock.tick(t);
    expect(clock.slowFrames()).toBe(0);
  });

  it("does not count a frame of exactly 50 ms", () => {
    expect(ticked([0, SLOW_FRAME_MS]).slowFrames()).toBe(0);
  });

  // Why: whatever the frames, the kept window stays bounded and the mean
  // lies between the best and the worst kept interval.
  it("stays bounded with a mean inside its intervals (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.1, max: 500, noNaN: true }), {
          maxLength: 300,
        }),
        (gaps) => {
          let t = 0;
          const times = [0, ...gaps.map((g) => (t += g))];
          const clock = ticked(times);
          const kept = clock.recentMs();
          expect(kept.length).toBeLessThanOrEqual(60);
          const mean = clock.meanMs();
          const inside =
            kept.length === 0 ||
            (mean >= Math.min(...kept) - 1e-9 &&
              mean <= clock.worstMs() + 1e-9);
          expect(inside).toBe(true);
          expect(clock.slowFrames()).toBeLessThanOrEqual(gaps.length);
        },
      ),
    );
  });

  // Why: a hidden tab or a paused loop (the canvas at 0 px) stops the
  // frames; the first frame after the return came a long gap after the
  // last, and the Performance tab then showed "1 frame over 50 ms" after
  // every return, a slow-down that never happened. The view says when its
  // frames stop (`pause`): the gap after it is not timed, not slow, and
  // the clock starts again from the next frame.
  it("does not time the gap after a pause", () => {
    const clock = ticked([0, 16, 32]);
    clock.pause();
    clock.tick(5000);
    clock.tick(5016);
    expect(clock.slowFrames()).toBe(0);
    expect(clock.recentMs()).toEqual([16, 16, 16]);
    expect(clock.count()).toBe(3);
  });

  // Why: a gap length cannot tell a pause from a hitch. Read as a pause,
  // a real 1.5 s hitch (a shader compile, a tile burst) vanished from the
  // Performance tab, the worst slow-down of all; without a pause signal
  // every long frame is timed and counted.
  it("counts a long frame that is not a pause, however long", () => {
    const clock = ticked([0, 16, 1516, 1532]);
    expect(clock.slowFrames()).toBe(1);
    expect(clock.worstMs()).toBe(1500);
    expect(clock.count()).toBe(3);
  });

  // Why: a hidden tab stops the browser's frames without the loop knowing;
  // the page's visibility is the signal. Only hiding pauses (a frame drawn
  // while shown is timed), and the listener goes with the view.
  it("pauses the clock when the page is hidden", () => {
    const page = Object.assign(new EventTarget(), { hidden: false });
    const clock = ticked([0, 16]);
    const stop = pauseWhenHidden(clock, page);
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    clock.tick(9000);
    expect(clock.slowFrames()).toBe(0);
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    clock.tick(9100);
    expect(clock.slowFrames()).toBe(1);
    stop();
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    clock.tick(12000);
    expect(clock.slowFrames()).toBe(2);
  });

  // Why: the browser's own question (an unsaved-work guard before opening
  // another tour or reloading) holds the page still until it is answered,
  // the 3D view's frames with it. That wait is no slow frame: timed, it
  // put a hitch of the answer's length into the Performance tab and its
  // badge. The question tells the clocks their frames stopped; the
  // answer is the question's, and a frame drawn after it is timed again.
  it("does not time the wait for the browser's question", () => {
    const page = Object.assign(new EventTarget(), { hidden: false });
    const clock = ticked([0, 16]);
    const stop = pauseWhenHidden(clock, page);
    const asked: string[] = [];
    const answer = confirmPausingFrames("Open another tour?", page, (m) => {
      asked.push(m);
      return false;
    });
    expect(answer).toBe(false);
    expect(asked).toEqual(["Open another tour?"]);
    clock.tick(6000);
    expect(clock.slowFrames()).toBe(0);
    expect(clock.worstMs()).toBe(16);
    clock.tick(6100);
    expect(clock.slowFrames()).toBe(1);
    expect(confirmPausingFrames("Reload?", page, () => true)).toBe(true);
    clock.tick(6200);
    expect(clock.slowFrames()).toBe(1);
    // Stopped listening (the view closed): a question no longer pauses it.
    stop();
    confirmPausingFrames("Reload?", page, () => true);
    clock.tick(9000);
    expect(clock.slowFrames()).toBe(2);
  });
});
