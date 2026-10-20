/**
 * Why these properties matter: the request ceiling is what keeps the
 * editor inside the OSM tile usage policy whatever the camera does. Over
 * random bursts of requests (any count, any spacing, any ceiling), every
 * request made through the ceiling's wait, as the overlay's fetch makes
 * it, leaves no sliding minute with more than the ceiling, and none is
 * dropped: each one is made, later if it must.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createRequestCeiling } from "./globe-osm-overlay.js";

describe("createRequestCeiling over random bursts", () => {
  it("never lets a sliding minute exceed the ceiling, and makes every request", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.array(fc.integer({ min: 0, max: 20_000 }), {
          minLength: 1,
          maxLength: 80,
        }),
        (perMinute, gaps) => {
          let t = 0;
          const ceiling = createRequestCeiling(perMinute, () => t);
          const made: number[] = [];
          for (const gap of gaps) {
            t += gap;
            // The overlay's fetch: wait until one more fits, then take.
            for (let w = ceiling.waitMs(); w > 0; w = ceiling.waitMs()) t += w;
            ceiling.take();
            made.push(t);
          }
          expect(made).toHaveLength(gaps.length);
          expect(ceiling.total()).toBe(gaps.length);
          let worst = 0;
          for (let i = 0; i < made.length; i++) {
            let j = i;
            while (j < made.length && made[j]! < made[i]! + 60_000) j++;
            worst = Math.max(worst, j - i);
          }
          expect(worst).toBeLessThanOrEqual(perMinute);
        },
      ),
    );
  });
});
