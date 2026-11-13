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
import { shortTextLook } from "gps-plus-slam-app-framework/ar/tour-short-text";
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
    view: "speak",
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

describe("a short text's point and language edits", () => {
  const SIGN = {
    id: "s",
    kind: "shortText",
    view: "sign",
    caption: "Sign",
    geo: GEO,
  } as unknown as TourObject;
  const strict = {
    at: "t",
    id: "s",
    assets: new Map(),
    characters: new Map(),
    fail: (m: string): never => {
      throw new Error(m);
    },
    lenient: false,
    onDropped: undefined,
  };
  const within = fc.double({ min: -1000, max: 1000, noNaN: true });

  it("write only what the format's reader keeps, whatever is typed", () => {
    // Why: a refused edit is the inspector's to explain, but an accepted
    // one must never produce a file the reader fails or trims.
    fc.assert(
      fc.property(
        fc.constantFrom("pointsTo", "lang"),
        fc.oneof(
          fc.string({ maxLength: 40 }),
          fc.tuple(within, within, within).map((p) => p.join(" ")),
          fc.constantFrom("en", "pt-BR", "zh-Hant-TW", "1001 0 0", "1 2"),
        ),
        (name, value) => {
          const out = blockFieldEdit(SIGN, name, value);
          if (out.kind !== "edited") return;
          const fields = out.after as unknown as Record<string, unknown>;
          expect(shortTextLook(fields, strict)).toMatchObject({
            [name]: fields[name],
          });
        },
      ),
      { numRuns: 300 },
    );
  });

  it("show a written point so that typing it back changes nothing", () => {
    // Why: the box is redrawn from the block after every write; a shown
    // value that read back differently would edit the block on blur.
    fc.assert(
      fc.property(within, within, within, (x, y, z) => {
        const set = {
          ...(SIGN as unknown as Record<string, unknown>),
          pointsTo: [x, y, z],
        } as unknown as TourObject;
        const shown = blockFields(set).find((f) => f.name === "pointsTo");
        expect(blockFieldEdit(set, "pointsTo", shown!.value)).toEqual({
          kind: "unchanged",
        });
      }),
      { numRuns: 300 },
    );
  });
});
