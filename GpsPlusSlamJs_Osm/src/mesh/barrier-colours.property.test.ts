import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { barrierColour } from "./barrier-colours.js";

const channels = (rgb: number): [number, number, number] => [
  (rgb >> 16) & 0xff,
  (rgb >> 8) & 0xff,
  rgb & 0xff,
];
const chroma = (rgb: number): number => {
  const c = channels(rgb);
  return Math.max(...c) - Math.min(...c);
};
const luma = (rgb: number): number => {
  const [r, g, b] = channels(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const KINDS = ["wall", "city_wall", "retaining_wall", "fence", "hedge"];
const MATERIALS = [
  "brick",
  "stone",
  "dry_stone",
  "sandstone",
  "concrete",
  "wood",
  "metal",
  "chain_link",
  "steel",
  "plastic",
  "constructor",
];

/**
 * WHY THESE PROPERTIES MATTER. The palette is meant to sit quietly behind
 * the buildings. An untagged colour must stay muted and mid-light whatever
 * the tags (chroma at most 56, brick being the most coloured of the O1
 * table; luma 100 to 170, neither a black wall nor a white one), and a
 * tagged colour must land between the kind colour and the tag, channel by
 * channel: a mix that overshoots would draw a colour nobody chose.
 */
describe("barrierColour properties", () => {
  const tagsArb = fc.record(
    {
      barrier: fc.constantFrom(...KINDS),
      material: fc.constantFrom(...MATERIALS),
      fence_type: fc.constantFrom(...MATERIALS),
      wall: fc.constantFrom(...MATERIALS),
    },
    { requiredKeys: ["barrier"] },
  );

  it("an untagged colour stays muted and mid-light", () => {
    fc.assert(
      fc.property(tagsArb, (tags) => {
        const rgb = barrierColour(tags);
        expect(chroma(rgb)).toBeLessThanOrEqual(56);
        expect(luma(rgb)).toBeGreaterThanOrEqual(100);
        expect(luma(rgb)).toBeLessThanOrEqual(170);
      }),
    );
  });

  it("a tagged colour lands between the base and the tag, per channel", () => {
    fc.assert(
      fc.property(tagsArb, fc.integer({ min: 0, max: 0xffffff }), (tags, c) => {
        const base = channels(barrierColour(tags));
        const tag = channels(c);
        const hex = `#${c.toString(16).padStart(6, "0")}`;
        const got = channels(barrierColour({ ...tags, colour: hex }));
        for (let i = 0; i < 3; i++) {
          const lo = Math.min(base[i]!, tag[i]!);
          const hi = Math.max(base[i]!, tag[i]!);
          // One step of rounding either way.
          expect(got[i]).toBeGreaterThanOrEqual(lo - 1);
          expect(got[i]).toBeLessThanOrEqual(hi + 1);
        }
      }),
    );
  });

  it("is a 24-bit colour for any tag soup, and deterministic", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.string()), (tags) => {
        const rgb = barrierColour(tags);
        expect(Number.isInteger(rgb)).toBe(true);
        expect(rgb).toBeGreaterThanOrEqual(0);
        expect(rgb).toBeLessThanOrEqual(0xffffff);
        expect(barrierColour({ ...tags })).toBe(rgb);
      }),
    );
  });
});
