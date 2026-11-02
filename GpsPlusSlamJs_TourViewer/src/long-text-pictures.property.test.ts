/**
 * Why this test matters: the decode budget only protects a phone if no
 * scroll position, however the pictures fall, ever plans more pixels than
 * it allows, and if the plan never shows a picture far from the view nor
 * lets go of one inside it. Hand-picked cases cannot cover the
 * combinations of sizes and distances; generated ones can.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { planPictures, type PicturePlanEntry } from "./long-text-pictures.js";

const MP = 1_000_000;

const entries = fc.array(
  fc.record({
    pixels: fc.option(fc.integer({ min: 1, max: 16_777_216 }), {
      nil: null,
    }),
    screensAway: fc.double({ min: 0, max: 6, noNaN: true }),
    shown: fc.boolean(),
  }),
  { maxLength: 20 },
);

/** Only states the controller can reach: shown pictures have a size and
 *  fit the budget together. */
function reachable(list: PicturePlanEntry[], budget: number): boolean {
  let sum = 0;
  for (const e of list) {
    if (!e.shown) continue;
    if (e.pixels === null) return false;
    sum += e.pixels;
  }
  return sum <= budget;
}

describe("planPictures (property)", () => {
  it("never plans more pixels than the budget, nothing far, and keeps what is near", () => {
    fc.assert(
      fc.property(
        entries,
        fc.integer({ min: 16, max: 48 }).map((m) => m * MP),
        (list, budget) => {
          fc.pre(reachable(list, budget));
          const plan = planPictures(list, budget);
          let sum = 0;
          const broken: string[] = [];
          list.forEach((e, i) => {
            const shows = plan.show.has(i);
            const released = plan.release.has(i);
            if (shows) sum += e.pixels ?? 0;
            if (shows && released)
              broken.push(`${String(i)} shown and released`);
            if (released !== (e.shown && !shows))
              broken.push(`${String(i)} released wrongly`);
            if (shows && e.screensAway >= 2) broken.push(`${String(i)} far`);
            if (shows && !e.shown && e.screensAway > 1)
              broken.push(`${String(i)} admitted beyond a screen`);
            if (e.shown && e.screensAway < 2 && !shows)
              broken.push(`${String(i)} let go while near`);
          });
          expect(broken).toEqual([]);
          expect(sum).toBeLessThanOrEqual(budget);
        },
      ),
      { numRuns: 500 },
    );
  });
});
