import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { bodyPictureAssets } from "./long-text-body-assets.js";

/** A picture line as a body may hold it: on its own, in a list item, in a
 *  quote. */
const wrapped = fc.tuple(
  fc.constantFrom("a", "b", "mill", "gate-2", "x_y"),
  fc.constantFrom(
    (id: string) => `![alt](asset:${id})`,
    (id: string) => `- ![alt](asset:${id})`,
    (id: string) => `> ![alt](asset:${id})`,
  ),
);

describe("the pictures a body shows (property)", () => {
  // Why this test matters: whatever the mix of nesting and repeats, a
  // write must keep every picture a body shows and list each once, in the
  // body's order - the order the tour's assets are then kept in.
  it("lists each shown picture once, in the body's order", () => {
    fc.assert(
      fc.property(
        fc.array(wrapped, { maxLength: 12 }),
        fc.string({ maxLength: 6 }).map((s) => s.replace(/[^a-z ]/gu, "")),
        (pictures, words) => {
          const body = [
            `Words ${words}.`,
            ...pictures.map(([id, wrap]) => wrap(id)),
          ].join("\n\n");
          const expected = [...new Set(pictures.map(([id]) => id))];
          expect(bodyPictureAssets(body)).toEqual(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});
