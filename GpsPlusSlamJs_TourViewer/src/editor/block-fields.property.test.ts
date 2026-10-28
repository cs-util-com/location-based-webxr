/**
 * Why this property matters (B2c acceptance): any sequence of block field
 * edits from the inspector must keep the block one the writer and the
 * reader accept - no cap broken, no field written blank, no field the
 * block needs emptied, the block's kind,
 * id, view and place untouched. A unit test checks the cases someone
 * thought of; this one types arbitrary text, emoji and whitespace runs
 * into every field of every kind.
 */
import fc from "fast-check";
import {
  TOUR_BLOCK_TEXT_RULES,
  checkTourBlockText,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { blockFieldEdit, blockFields } from "./block-fields.js";

const GEO = { lat: 48.1, lon: 11.5, alt: 520, headingDeg: 0 };
const BLOCKS = [
  { id: "p", kind: "shortText", view: "pin", caption: "Pin", geo: GEO },
  {
    id: "ph",
    kind: "picture",
    view: "plane",
    image: "ph",
    widthM: 1,
    geo: GEO,
  },
  { id: "m", kind: "model", view: "placed", asset: "a", sizeM: 1, geo: GEO },
  { id: "l", kind: "longText", view: "card", title: "T", body: "B" },
  { id: "v", kind: "video", view: "card", video: "c", transcript: "W" },
  { id: "au", kind: "audio", view: "card", audio: "s", transcript: "W" },
  {
    id: "ch",
    kind: "character",
    view: "stage",
    name: "N",
    image: "i",
    caption: "C",
  },
] as unknown as TourObject[];

const text = fc.oneof(
  fc.string({ maxLength: 50 }),
  fc.string({ unit: "grapheme", maxLength: 400 }),
  fc.constantFrom(
    "",
    "   ",
    "\n\n",
    "x".repeat(1300),
    "\u{1F600}".repeat(41),
    // Under the body's cap in characters, over it in UTF-16 units.
    "\u{1F600}".repeat(16_001),
  ),
);
const field = fc.constantFrom(
  "title",
  "caption",
  "description",
  "alt",
  "body",
  "transcript",
  "name",
);

describe("block field edits", () => {
  it("keep every text field within its rule, the envelope untouched", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BLOCKS),
        fc.array(fc.tuple(field, text), { maxLength: 12 }),
        (start, edits) => {
          let block = start;
          for (const [name, value] of edits) {
            const out = blockFieldEdit(block, name, value);
            if (out.kind === "edited") block = out.after;
          }
          const rules = TOUR_BLOCK_TEXT_RULES[block.kind] as Readonly<
            Record<string, Parameters<typeof checkTourBlockText>[0]>
          >;
          for (const f of blockFields(block)) {
            const value = (block as unknown as Record<string, unknown>)[f.name];
            // A field the block needs is never emptied.
            expect(!f.required || typeof value === "string").toBe(true);
            if (value === undefined) continue;
            const rule = rules[f.name];
            expect(rule).toBeDefined();
            expect(checkTourBlockText(rule!, value).ok).toBe(true);
          }
          for (const key of ["id", "kind", "view", "geo"] as const) {
            expect(block[key]).toEqual(start[key]);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
