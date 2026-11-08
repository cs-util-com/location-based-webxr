import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  TREE_COLOUR_JITTER,
  treeClass,
  treeColour,
  type TreeClass,
} from "./trees.js";

const chroma = (rgb: number): number => {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return Math.max(r, g, b) - Math.min(r, g, b);
};

/**
 * The highest chroma any tree colour may reach, sRGB max minus min channel.
 *
 * NOT the plan's 35: the O1 palette the owner chose carries the larch-type
 * green 0x80875f at chroma 40 and broadleaved/unknown 0x77845f at 37, and the
 * plus 8 percent lightness spread lifts the larch to 43. 45 is O1's own
 * measured ceiling (its report, the tint sweep) and stays far below today's
 * tree green at 62 (DEC-R4-5), which is what "muted" is measured against.
 */
const MAX_TREE_CHROMA = 45;

const leafTypes = ["broadleaved", "needleleaved", "mixed", "unknown"] as const;
const leafCycles = ["deciduous", "evergreen", "unknown"] as const;
const classArb: fc.Arbitrary<TreeClass> = fc.record({
  leafType: fc.constantFrom(...leafTypes),
  leafCycle: fc.constantFrom(...leafCycles),
  source: fc.constant("none" as const),
});

describe("tree colour properties", () => {
  it("stays muted for every class, key and jitter up to the default", () => {
    // WHY THIS MATTERS. The tree green must never compete with the heat ramp
    // or read as today's saturated green, whatever the key's lightness draw.
    fc.assert(
      fc.property(
        classArb,
        fc.string(),
        fc.double({ min: 0, max: TREE_COLOUR_JITTER, noNaN: true }),
        (cls, key, jitter) => {
          expect(chroma(treeColour(cls, key, jitter))).toBeLessThanOrEqual(
            MAX_TREE_CHROMA,
          );
        },
      ),
    );
  });

  it("is deterministic per key", () => {
    // WHY THIS MATTERS. This is an AR overlay used to judge pose: a tree that
    // changes colour between reloads or between two phones is noise.
    fc.assert(
      fc.property(classArb, fc.string(), (cls, key) => {
        expect(treeColour(cls, key)).toBe(treeColour(cls, key));
      }),
    );
  });

  it("classifies any tag soup without throwing, into the closed vocabulary", () => {
    // WHY THIS MATTERS. Tags are free text from the map; a value outside the
    // vocabulary must land on unknown, never on an inherited property.
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom(
            "leaf_type",
            "wood",
            "leaf_cycle",
            "genus",
            "species",
            "taxon",
          ),
          fc.oneof(
            fc.string(),
            fc.constantFrom("constructor", "__proto__", "Larix sp."),
          ),
        ),
        (tags) => {
          const cls = treeClass(tags);
          expect(leafTypes).toContain(cls.leafType);
          expect(leafCycles).toContain(cls.leafCycle);
          expect(["leaf_type", "wood", "genus", "none"]).toContain(cls.source);
        },
      ),
    );
  });
});
