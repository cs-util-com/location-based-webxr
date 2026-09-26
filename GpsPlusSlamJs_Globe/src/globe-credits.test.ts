/**
 * Why this test matters: the credits line must name every source on screen,
 * once, in a stable order (a line that reorders as tiles load reads as
 * flicker), in the same shape as OsmDemo's attribution entries so phase 5
 * hands it over unchanged.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { creditsFor } from "./globe-credits.js";
import { GLOBE_SOURCES } from "./globe-sources.js";

describe("creditsFor", () => {
  it("returns one entry per credit, in registry order", () => {
    const ids = GLOBE_SOURCES.map((s) => s.id);
    const credits = creditsFor([...ids].reverse());
    expect(credits.map((c) => c.short)).toEqual(
      GLOBE_SOURCES.map((s) => s.credit.short).filter(
        (short, i, all) => all.indexOf(short) === i,
      ),
    );
    for (const c of credits) {
      expect(Object.keys(c).sort()).toEqual(["full", "href", "short"]);
    }
  });

  it("is empty for no sources and refuses an unknown id", () => {
    expect(creditsFor([])).toEqual([]);
    expect(() => creditsFor(["nope" as never])).toThrow(RangeError);
  });

  it("for any selection: no duplicates, registry order, every source credited", () => {
    const ids = GLOBE_SOURCES.map((s) => s.id);
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ids), { maxLength: 12 }),
        (picked) => {
          const credits = creditsFor(picked);
          const shorts = credits.map((c) => c.short);
          expect(new Set(shorts).size).toBe(shorts.length);
          const order = GLOBE_SOURCES.map((s) => s.credit.short);
          const positions = shorts.map((s) => order.indexOf(s));
          expect([...positions].sort((a, b) => a - b)).toEqual(positions);
          for (const id of picked) {
            const short = GLOBE_SOURCES.find((s) => s.id === id)?.credit.short;
            expect(shorts).toContain(short);
          }
        },
      ),
    );
  });
});
