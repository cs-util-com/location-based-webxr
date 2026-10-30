/**
 * Why this test matters: the credits line must name every source on screen,
 * once, in a stable order (a line that reorders as tiles load reads as
 * flicker), in the same shape as OsmDemo's attribution entries so phase 5
 * hands it over unchanged.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  PROCEDURAL_STARS,
  creditsFor,
  globeCreditsLine,
} from "./globe-credits.js";
import { GIBS_ACKNOWLEDGEMENT, GLOBE_SOURCES } from "./globe-sources.js";

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

// Why: the credits line moved out of the lab as a pure refactor; its text
// is what the reference views' credits are compared by, so the summary's
// wording, its order and which credits are linked must not change.
describe("globeCreditsLine", () => {
  const imagery = [
    { short: "A", full: "A full", href: "https://a.example" },
    { short: "B", full: "B full", href: "https://b.example" },
  ];
  const relief = [{ short: "R", full: "R full", href: "https://r.example" }];
  const map = [{ short: "M", full: "M full", href: "https://m.example" }];

  it("names the imagery and the stars without a relief", () => {
    const line = globeCreditsLine(imagery);
    expect(line.summary).toBe(`Imagery: A · B. ${PROCEDURAL_STARS}`);
    expect(line.links).toEqual(imagery);
    expect(line.note).toBe(GIBS_ACKNOWLEDGEMENT);
  });

  it("links the relief's credits and the map's after the imagery", () => {
    const line = globeCreditsLine(imagery, relief, map);
    expect(line.summary).toBe(
      `Imagery: A · B. ${PROCEDURAL_STARS} R full Map: M full`,
    );
    expect(line.links).toEqual([...imagery, ...relief, ...map]);
  });

  it("shows a plain heights sentence without linking it", () => {
    const line = globeCreditsLine(imagery, "Heights: synthetic.");
    expect(line.summary).toBe(
      `Imagery: A · B. ${PROCEDURAL_STARS} Heights: synthetic.`,
    );
    expect(line.links).toEqual(imagery);
  });
});
