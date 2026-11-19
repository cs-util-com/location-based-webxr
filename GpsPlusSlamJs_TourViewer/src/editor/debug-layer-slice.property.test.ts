/**
 * Why these tests matter: whatever a recording holds, what the layer
 * keeps must be drawable by both views - every kept capture has a unique
 * name and a finite place on the Earth, in the order they came - and no
 * sequence of switches, drawings and clears can leave captures without a
 * source (the globe would draw a closed tour's walk).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  debugLayerActions as act,
  debugLayerReducer as reduce,
  debugPlacesOf,
} from "./debug-layer-slice.js";

const capture = fc.record({
  image: fc.oneof(fc.constantFrom("a", "b", "c", ""), fc.string()),
  lat: fc.oneof(fc.double(), fc.double({ min: -90, max: 90, noNaN: true })),
  lon: fc.oneof(fc.double(), fc.double({ min: -180, max: 180, noNaN: true })),
  alt: fc.double(),
});

describe("debugLayer (properties)", () => {
  it("keeps only unique names with finite places on the Earth, in their order", () => {
    fc.assert(
      fc.property(fc.array(capture, { maxLength: 40 }), (captures) => {
        const kept = debugPlacesOf(captures);
        const names = kept.map((c) => c.image);
        expect(new Set(names).size).toBe(names.length);
        for (const c of kept) {
          expect(c.image).not.toBe("");
          expect(Number.isFinite(c.lat) && Math.abs(c.lat) <= 90).toBe(true);
          expect(Number.isFinite(c.lon) && Math.abs(c.lon) <= 180).toBe(true);
          expect(Number.isFinite(c.alt)).toBe(true);
        }
        // In the order they came: a subsequence of the captures.
        let at = 0;
        for (const c of kept) {
          while (at < captures.length && captures[at]?.image !== c.image) at++;
          expect(at).toBeLessThan(captures.length);
          at++;
        }
      }),
    );
  });

  it("never holds captures without a source", () => {
    const action = fc.oneof(
      fc
        .constantFrom("walk" as const, "added" as const)
        .map((source) => act.started({ source })),
      fc
        .array(capture, { maxLength: 5 })
        .map((captures) => act.drawn({ captures })),
      fc.boolean().map((on) => act.shownChanged({ on })),
      fc.constant(act.cleared()),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 30 }), (actions) => {
        let s = reduce(undefined, { type: "@@init" });
        for (const a of actions) {
          s = reduce(s, a);
          expect(s.source !== null || s.captures === null).toBe(true);
        }
      }),
    );
  });
});
