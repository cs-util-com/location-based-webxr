/**
 * The landing's step cards: which picture moves, and when.
 *
 * Why these tests matter: the cards replaced a page where pictures played
 * once and were over before a reader noticed them, and before that a
 * scroll-driven scene that flashed by. The rules here are what makes the
 * motion calm: a picture starts only once enough of it is in view and the
 * reader has stopped scrolling past it, only the picture most in view
 * moves, it keeps moving (play, hold the last frame, play again) until it
 * is tapped or leaves the view, a tap freezes it until the next tap (also
 * across a scroll away and back), "Show again" restarts it, reduced motion
 * moves nothing by itself, and no card starts while the film above plays.
 * Every one of these was a decision; a regression in any would bring back
 * the motion the page was built to avoid, and nothing on the page would
 * report it.
 */
import { describe, expect, it } from "vitest";

import {
  createCardPlay,
  HOLD_MS,
  SETTLE_MS,
  START_SHARE,
  type CardState,
} from "./card-play.js";
import { manualTimer } from "../test-support/manual-timer.js";

const DURATIONS = [2000, 2600, 3300, 2600, 2600];

function setup(options: { reducedMotion?: boolean } = {}) {
  const timer = manualTimer();
  const renders: { index: number; state: CardState }[] = [];
  const play = createCardPlay({
    durationsMs: DURATIONS,
    reducedMotion: options.reducedMotion ?? false,
    timer,
    render: (index, state) => {
      renders.push({ index, state });
    },
  });
  const phase = (i: number) => play.state(i).phase;
  return { timer, play, renders, phase };
}

describe("createCardPlay", () => {
  it("starts a picture once enough of it has stayed in view for the settle delay", () => {
    const { timer, play, phase } = setup();
    play.seen(1, START_SHARE);
    expect(phase(1)).toBe("still");
    timer.advance(SETTLE_MS - 1);
    expect(phase(1)).toBe("still");
    timer.advance(1);
    expect(phase(1)).toBe("playing");
    expect(play.state(1).run).toBe(1);
  });

  it("starts nothing for a picture scrolled past before the delay is over", () => {
    const { timer, play, phase } = setup();
    play.seen(2, 1);
    timer.advance(SETTLE_MS - 10);
    play.seen(2, 0.2);
    timer.advance(10 * SETTLE_MS);
    expect(phase(2)).toBe("still");
  });

  it("starts nothing for a picture less in view than the start share", () => {
    const { timer, play, phase } = setup();
    play.seen(0, START_SHARE - 0.05);
    timer.advance(10 * SETTLE_MS);
    expect(phase(0)).toBe("still");
  });

  it("keeps moving: plays, holds its last frame, and plays again", () => {
    const { timer, play, phase } = setup();
    play.seen(1, 1);
    timer.advance(SETTLE_MS);
    expect(phase(1)).toBe("playing");
    timer.advance(DURATIONS[1]! - 1);
    expect(phase(1)).toBe("playing");
    timer.advance(1);
    expect(phase(1)).toBe("holding");
    timer.advance(HOLD_MS);
    expect(phase(1)).toBe("playing");
    expect(play.state(1).run).toBe(2);
  });

  it("stops at its last frame when it leaves the view, and starts again when it comes back", () => {
    const { timer, play, phase } = setup();
    play.seen(3, 1);
    timer.advance(SETTLE_MS + 500);
    play.seen(3, 0.1);
    expect(phase(3)).toBe("still");
    play.seen(3, 1);
    timer.advance(SETTLE_MS);
    expect(phase(3)).toBe("playing");
    expect(play.state(3).run).toBe(2);
  });

  it("moves only the picture most in view; the other holds its last frame", () => {
    const { timer, play, phase } = setup();
    play.seen(0, START_SHARE);
    play.seen(1, 1);
    timer.advance(SETTLE_MS);
    expect(phase(1)).toBe("playing");
    expect(phase(0)).toBe("still");
    // The reader scrolls on: the first falls back, the second takes over.
    play.seen(1, 0.4);
    expect(phase(1)).toBe("still");
    timer.advance(SETTLE_MS);
    expect(phase(0)).toBe("playing");
  });

  it("keeps the picture already moving when another is just as much in view", () => {
    const { timer, play, phase } = setup();
    play.seen(2, 1);
    timer.advance(SETTLE_MS);
    play.seen(3, 1);
    timer.advance(5 * SETTLE_MS);
    expect(phase(2)).not.toBe("still");
    expect(phase(3)).toBe("still");
  });

  it("freezes on a tap and goes on from the same moment on the next", () => {
    const { timer, play, phase } = setup();
    play.seen(1, 1);
    timer.advance(SETTLE_MS + 1000);
    play.tap(1);
    expect(play.state(1)).toEqual({ phase: "playing", paused: true, run: 1 });
    timer.advance(60_000);
    expect(play.state(1)).toEqual({ phase: "playing", paused: true, run: 1 });
    play.tap(1);
    expect(play.state(1).paused).toBe(false);
    // 1000 of its 2600 ms had played: 1600 remain.
    timer.advance(1599);
    expect(phase(1)).toBe("playing");
    timer.advance(1);
    expect(phase(1)).toBe("holding");
  });

  it("holds a pause across a scroll away and back", () => {
    const { timer, play } = setup();
    play.seen(4, 1);
    timer.advance(SETTLE_MS + 300);
    play.tap(4);
    play.seen(4, 0);
    timer.advance(1000);
    play.seen(4, 1);
    timer.advance(10 * SETTLE_MS);
    expect(play.state(4)).toEqual({ phase: "playing", paused: true, run: 1 });
  });

  it("lets no other picture move in place of a paused one most in view", () => {
    const { timer, play, phase } = setup();
    play.seen(1, 1);
    play.seen(2, START_SHARE);
    timer.advance(SETTLE_MS);
    play.tap(1);
    timer.advance(10 * SETTLE_MS);
    expect(phase(2)).toBe("still");
  });

  it("can pause a picture that is not moving, which then stays still", () => {
    const { timer, play, phase } = setup();
    play.tap(0);
    play.seen(0, 1);
    timer.advance(10 * SETTLE_MS);
    expect(play.state(0)).toEqual({ phase: "still", paused: true, run: 0 });
    play.tap(0);
    timer.advance(SETTLE_MS);
    expect(phase(0)).toBe("playing");
  });

  it("resumes a tapped picture that is no longer most in view at its last frame", () => {
    const { timer, play, phase } = setup();
    play.seen(1, 1);
    timer.advance(SETTLE_MS + 400);
    play.tap(1);
    play.seen(1, 0.3);
    play.tap(1);
    expect(play.state(1)).toEqual({ phase: "still", paused: false, run: 1 });
    timer.advance(10 * SETTLE_MS);
    expect(phase(1)).toBe("still");
  });

  it("restarts on Show again, clearing the pause, without the settle delay", () => {
    const { timer, play } = setup();
    play.seen(2, 1);
    timer.advance(SETTLE_MS + 700);
    play.tap(2);
    play.showAgain(2);
    expect(play.state(2)).toEqual({ phase: "playing", paused: false, run: 2 });
    timer.advance(DURATIONS[2]!);
    expect(play.state(2).phase).toBe("holding");
  });

  it("Show again on a picture not most in view moves it once, then gives way", () => {
    const { timer, play, phase } = setup();
    play.seen(0, 1);
    play.seen(1, 0.5);
    timer.advance(SETTLE_MS);
    expect(phase(0)).toBe("playing");
    play.showAgain(1);
    expect(phase(0)).toBe("still");
    expect(phase(1)).toBe("playing");
    timer.advance(DURATIONS[1]!);
    expect(phase(1)).toBe("still");
    timer.advance(SETTLE_MS);
    expect(phase(0)).toBe("playing");
  });

  describe("under reduced motion", () => {
    it("starts nothing by itself", () => {
      const { timer, play, phase } = setup({ reducedMotion: true });
      play.seen(1, 1);
      timer.advance(60_000);
      expect(phase(1)).toBe("still");
    });

    it("plays once on Show again, then shows the last frame", () => {
      const { timer, play, phase } = setup({ reducedMotion: true });
      play.seen(1, 1);
      play.showAgain(1);
      expect(phase(1)).toBe("playing");
      timer.advance(DURATIONS[1]!);
      expect(phase(1)).toBe("still");
      timer.advance(60_000);
      expect(phase(1)).toBe("still");
    });
  });

  describe("while the film plays", () => {
    it("starts no card, and stops the one moving", () => {
      const { timer, play, phase } = setup();
      play.seen(0, 1);
      timer.advance(SETTLE_MS);
      play.setBlocked(true);
      expect(phase(0)).toBe("still");
      play.seen(1, 1);
      timer.advance(60_000);
      expect(phase(0)).toBe("still");
      expect(phase(1)).toBe("still");
    });

    it("lets the card most in view start after the settle delay once it stops", () => {
      const { timer, play, phase } = setup();
      play.setBlocked(true);
      play.seen(0, 1);
      timer.advance(SETTLE_MS);
      play.setBlocked(false);
      expect(phase(0)).toBe("still");
      timer.advance(SETTLE_MS);
      expect(phase(0)).toBe("playing");
    });

    it("still plays a picture the reader asked for with Show again", () => {
      const { play, phase } = setup();
      play.setBlocked(true);
      play.showAgain(3);
      expect(phase(3)).toBe("playing");
    });
  });

  it("renders a card only when its state changes, so an idle page does nothing", () => {
    const { timer, play, renders } = setup();
    play.seen(0, 0.2);
    play.seen(0, 0.3);
    timer.advance(60_000);
    expect(renders).toEqual([]);
    expect(timer.pending()).toBe(0);
  });

  it("stops every timer on destroy", () => {
    const { timer, play, renders } = setup();
    play.seen(0, 1);
    timer.advance(SETTLE_MS);
    const before = renders.length;
    play.destroy();
    expect(timer.pending()).toBe(0);
    timer.advance(60_000);
    play.seen(1, 1);
    play.tap(1);
    play.showAgain(2);
    timer.advance(60_000);
    expect(renders.length).toBe(before);
  });

  describe("bad input", () => {
    it("ignores an index outside the cards", () => {
      const { timer, play, renders } = setup();
      play.seen(-1, 1);
      play.seen(5, 1);
      play.seen(1.5, 1);
      play.tap(9);
      play.showAgain(-2);
      timer.advance(60_000);
      expect(renders).toEqual([]);
      expect(play.state(9)).toEqual({ phase: "still", paused: false, run: 0 });
    });

    it("reads a share that is not a number as nothing in view", () => {
      const { timer, play, phase } = setup();
      play.seen(0, Number.NaN);
      play.seen(1, Number.POSITIVE_INFINITY);
      timer.advance(60_000);
      expect(phase(0)).toBe("still");
      expect(phase(1)).toBe("still");
    });

    it("refuses durations that are not positive finite numbers", () => {
      for (const durationsMs of [[], [0], [-5], [Number.NaN], [Infinity]]) {
        expect(() =>
          createCardPlay({
            durationsMs,
            reducedMotion: false,
            timer: manualTimer(),
            render: () => undefined,
          }),
        ).toThrow(/duration/);
      }
    });
  });
});
