import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  restEndedAt,
  scrolledToShow,
  STRIP_HOLD_MS,
  STRIP_REST_PX,
  STRIP_SLOP_PX,
  stripGesture,
} from "./dock-strip.js";

describe("a finger on a tab of a strip that scrolls", () => {
  // Why: a phone's group holds seven tabs, more than its strip shows; a
  // swipe along the strip must scroll it, never tear the tab out (the
  // docking library makes any flick on a tab a drag).
  it("scrolls the strip for a quick sideways swipe", () => {
    expect(stripGesture({ dx: -40, dy: 4, ms: 80 }, true)).toBe("scroll");
    expect(stripGesture({ dx: STRIP_SLOP_PX, dy: 0, ms: 0 }, true)).toBe(
      "scroll",
    );
  });

  // Why: a tab is still dragged by a finger: pulled out of the strip
  // (up or down), or moved after a hold, which is how a tab is reordered.
  it("drags the tab when pulled across the strip, or moved after a hold", () => {
    expect(stripGesture({ dx: 3, dy: 30, ms: 60 }, true)).toBe("drag");
    expect(stripGesture({ dx: 20, dy: -20, ms: 60 }, true)).toBe("drag");
    expect(stripGesture({ dx: 40, dy: 0, ms: STRIP_HOLD_MS }, true)).toBe(
      "drag",
    );
  });

  // Why: under the slop the finger may still be a tap (it shows its tab)
  // or a hold (the tab's menu): nothing is decided yet.
  it("decides nothing while the finger stays inside the slop", () => {
    expect(stripGesture({ dx: 6, dy: 4, ms: 40 }, true)).toBe("undecided");
    expect(stripGesture({ dx: 0, dy: 0, ms: 900 }, true)).toBe("undecided");
  });

  // Why: where every tab fits there is nothing to scroll, and the
  // docking library's own touch rule stays as it was.
  it("leaves a strip that does not scroll to the docking", () => {
    expect(stripGesture({ dx: -40, dy: 0, ms: 80 }, false)).toBe("drag");
    expect(stripGesture({ dx: 0, dy: 0, ms: 0 }, false)).toBe("drag");
  });

  // Why: a broken move (no numbers) must not scroll anything.
  it("hands nonsense to the docking", () => {
    expect(stripGesture({ dx: Number.NaN, dy: 0, ms: 0 }, true)).toBe("drag");
    expect(stripGesture({ dx: 30, dy: 0, ms: Number.NaN }, true)).toBe("drag");
  });

  // Why: the slop is a judgement (Android's touch slop is 8 dp, the
  // docking's own press tolerance 8 px); swept from 4 to 24 px the rule
  // keeps its shape: a sideways move scrolls exactly from the slop on and
  // before the hold, and nothing at all is decided under the slop.
  it("keeps its shape at any slop and hold", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 24 }),
        fc.integer({ min: 150, max: 500 }),
        fc.integer({ min: -200, max: 200 }),
        fc.integer({ min: -200, max: 200 }),
        fc.integer({ min: 0, max: 1000 }),
        (slop, hold, dx, dy, ms) => {
          const got = stripGesture({ dx, dy, ms }, true, slop, hold);
          const far = Math.hypot(dx, dy) >= slop;
          const sideways = ms < hold && Math.abs(dx) > Math.abs(dy);
          const want = !far ? "undecided" : sideways ? "scroll" : "drag";
          expect(got).toBe(want);
        },
      ),
    );
  });
});

describe("how long a finger rested on a tab", () => {
  // Why: the hold that turns a move into a tab drag is a finger RESTING
  // before it moves. Timed to the slop instead, a slow swipe (and every
  // touch a busy test machine sends late) turned into a drag halfway
  // along: the finger had been moving all the while, never holding.
  it("ends when the finger first leaves its rest, and is kept from then", () => {
    expect(restEndedAt(null, { dx: 1, dy: 1 }, 40)).toBeNull();
    expect(restEndedAt(null, { dx: -STRIP_REST_PX, dy: 0 }, 60)).toBe(60);
    expect(restEndedAt(60, { dx: -40, dy: 0 }, 900)).toBe(60);
  });

  // Why: the rest is under the slop, or a swipe would be decided before
  // its rest was known; nonsense keeps the rest as it was.
  it("lies under the slop, and nonsense changes nothing", () => {
    expect(STRIP_REST_PX).toBeLessThan(STRIP_SLOP_PX);
    expect(STRIP_REST_PX).toBeGreaterThan(0);
    expect(restEndedAt(null, { dx: Number.NaN, dy: 0 }, 10)).toBeNull();
    expect(restEndedAt(null, { dx: 9, dy: 0 }, Number.NaN)).toBeNull();
    expect(restEndedAt(30, { dx: Number.NaN, dy: 0 }, 50)).toBe(30);
  });

  // Why: swept over rests of 2 to 9 px, the end is always the first time
  // the finger was that far out, never later and never undone.
  it("is the first time at or past the rest, at any rest", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 9 }),
        fc.array(fc.integer({ min: -30, max: 30 }), {
          minLength: 1,
          maxLength: 20,
        }),
        (rest, xs) => {
          let ended: number | null = null;
          let first: number | null = null;
          xs.forEach((dx, i) => {
            ended = restEndedAt(ended, { dx, dy: 0 }, i * 16, rest);
            if (first === null && Math.abs(dx) >= rest) first = i * 16;
          });
          expect(ended).toBe(first);
        },
      ),
    );
  });
});

describe("a tab scrolled into its strip", () => {
  // Why: the shown tab, and the one keyboard focus moves to, must be in
  // sight; the strip moves the least that brings it in, and not at all
  // when it is in sight already (a swipe the creator made is kept).
  it("moves the strip the least that shows the tab", () => {
    const strip = { scroll: 100, size: 300 };
    expect(scrolledToShow(strip, { start: 150, size: 46 })).toBe(100);
    expect(scrolledToShow(strip, { start: 40, size: 46 })).toBe(40);
    expect(scrolledToShow(strip, { start: 380, size: 46 })).toBe(126);
  });

  it("shows a tab wider than the strip from its start", () => {
    expect(
      scrolledToShow({ scroll: 0, size: 100 }, { start: 200, size: 160 }),
    ).toBe(200);
  });

  it("leaves the strip for nonsense", () => {
    const strip = { scroll: 30, size: 300 };
    expect(scrolledToShow(strip, { start: Number.NaN, size: 46 })).toBe(30);
    expect(
      scrolledToShow({ scroll: 30, size: 0 }, { start: 400, size: 46 }),
    ).toBe(30);
  });

  // Why: whatever the strip and the tab, the tab ends in sight (or its
  // start does, when it is wider than the strip).
  it("always ends with the tab in sight", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 1, max: 800 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 1, max: 300 }),
        (scroll, size, start, width) => {
          const at = scrolledToShow({ scroll, size }, { start, size: width });
          expect(start).toBeGreaterThanOrEqual(at);
          // A tab that fits ends in sight; a wider one starts at the edge.
          const inSight =
            width <= size ? start + width <= at + size : at === start;
          expect(inSight).toBe(true);
        },
      ),
    );
  });
});
