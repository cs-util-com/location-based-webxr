/**
 * Why these tests matter: iOS sends no context menu for a long press, so
 * on an iPhone or an iPad the ground menu ("New station here") had no way
 * to open. The long press is timed by the page instead: a finger held
 * still opens the menu, while a finger that moves (the camera's orbit), a
 * second finger (a pinch) or an early release never does. The hold and
 * the tolerance are swept over a plausible range, so the verdict does not
 * rest on one pair of values.
 */
import { describe, expect, it } from "vitest";

import { createLongPress, LONG_PRESS } from "./long-press.js";

/** A clock the test advances by hand. */
function clock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    schedule(run: () => void, ms: number): number {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    cancel(id: number): void {
      timers.delete(id);
    },
    advance(ms: number): void {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.run();
        }
      }
    },
  };
}

function setUp(holdMs: number, tolerancePx: number) {
  const time = clock();
  const fired: { x: number; y: number }[] = [];
  const press = createLongPress({
    holdMs,
    tolerancePx,
    schedule: time.schedule,
    cancel: time.cancel,
    fire: (at) => fired.push(at),
  });
  return { time, fired, press };
}

const HOLDS = [400, 500, 700];
const TOLERANCES = [4, 8, 12];

describe("createLongPress", () => {
  for (const holdMs of HOLDS) {
    for (const tolerancePx of TOLERANCES) {
      describe(`held ${String(holdMs)} ms, ${String(tolerancePx)} px`, () => {
        it("fires once where the finger went down, after the hold, while it stays within the tolerance", () => {
          const { time, fired, press } = setUp(holdMs, tolerancePx);
          press.down(1, { x: 100, y: 100 });
          press.move(1, { x: 100 + tolerancePx * 0.7, y: 100 });
          time.advance(holdMs - 1);
          expect(fired).toEqual([]);
          time.advance(1);
          expect(fired).toEqual([{ x: 100, y: 100 }]);
          time.advance(holdMs * 3);
          expect(fired).toHaveLength(1);
        });

        it("never fires for a finger that moved past the tolerance, even back again (an orbit)", () => {
          const { time, fired, press } = setUp(holdMs, tolerancePx);
          press.down(1, { x: 100, y: 100 });
          press.move(1, { x: 100, y: 100 + tolerancePx + 1 });
          press.move(1, { x: 100, y: 100 });
          time.advance(holdMs * 2);
          expect(fired).toEqual([]);
        });

        it("never fires for a second finger (a pinch) or a release before the hold", () => {
          const { time, fired, press } = setUp(holdMs, tolerancePx);
          press.down(1, { x: 100, y: 100 });
          press.down(2, { x: 200, y: 100 });
          time.advance(holdMs * 2);
          expect(fired).toEqual([]);
          press.end(1);
          press.end(2);
          press.down(3, { x: 50, y: 50 });
          time.advance(holdMs - 10);
          press.end(3);
          time.advance(holdMs);
          expect(fired).toEqual([]);
        });
      });
    }
  }

  it("ignores the moves and ends of other pointers, and stops on cancel", () => {
    const { time, fired, press } = setUp(
      LONG_PRESS.holdMs,
      LONG_PRESS.tolerancePx,
    );
    press.down(1, { x: 10, y: 10 });
    press.move(7, { x: 400, y: 400 });
    press.end(7);
    time.advance(LONG_PRESS.holdMs);
    expect(fired).toHaveLength(1);
    press.down(2, { x: 10, y: 10 });
    press.cancel();
    time.advance(LONG_PRESS.holdMs);
    expect(fired).toHaveLength(1);
  });

  it("holds about half a second, with the tap's tolerance", () => {
    expect(LONG_PRESS).toEqual({ holdMs: 500, tolerancePx: 8 });
  });
});
