/**
 * Why these properties matter: the story cards choose between drilling in
 * and showing all at once by the page's height, and a phone's keyboard
 * shrinks that height while a creator types. `steadyHeight` must never
 * report less than a height it already saw at the same width (else the
 * cards collapse under the typing finger), and must start over when the
 * width changes (a phone turned on its side is a new page).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { steadyHeight } from "./phone-sheet.js";

const height = fc.double({ min: 0, max: 5000, noNaN: true });
const width = fc.integer({ min: 200, max: 3000 });

describe("steadyHeight, as properties", () => {
  it("never reports less than a finite height seen since the width last changed", () => {
    fc.assert(
      fc.property(
        width,
        fc.array(
          fc.oneof(height, fc.constantFrom(Number.NaN, Infinity, -Infinity)),
          { minLength: 1, maxLength: 30 },
        ),
        (w, heights) => {
          const steady = steadyHeight();
          // Before any finite height the answer is 0 (nothing seen yet).
          let seen = 0;
          let any = false;
          for (const h of heights) {
            const out = steady(w, h);
            if (Number.isFinite(h)) {
              seen = any ? Math.max(seen, h) : h;
              any = true;
            }
            expect(out).toBe(seen);
          }
        },
      ),
    );
  });

  it("equals the new height whenever the width changes", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(width, height), { minLength: 1, maxLength: 30 }),
        (calls) => {
          const steady = steadyHeight();
          let last: number | null = null;
          for (const [w, h] of calls) {
            const out = steady(w, h);
            expect(w === last ? out >= h : out === h).toBe(true);
            last = w;
          }
        },
      ),
    );
  });
});
