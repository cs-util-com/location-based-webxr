/**
 * The visitor's view preference, as properties (design §8, "The
 * preference function"): for ANY stored value (garbage included), any
 * creator view and any block, the view shown has its needs met, stays in
 * the creator's view's placement, is the creator's view outside every set
 * and for the creator, and reading never rewrites what is stored.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TOUR_BLOCK_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";

import {
  preferredView,
  shownView,
  viewNeedsFail,
  viewSetOf,
  withPreferredView,
} from "./visitor-prefs.js";

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] } as const;

/** Bodies with and without picture blocks, at the top level and nested. */
const body = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constantFrom(
    "Words.",
    "![a](asset:x)",
    "Before.\n\n![a](asset:x)",
    "- item\n\n  ![a](asset:x)",
    "> ![a](asset:x)",
    "Look ![a](asset:x) inline.",
  ),
);

function longTextBlock(view: string, text: string): TourBlock {
  return {
    id: "t",
    kind: "longText",
    view,
    title: "T",
    body: text,
    pose: POSE,
  } as TourBlock;
}

const block: fc.Arbitrary<TourBlock> = fc.oneof(
  fc
    .record({
      view: fc.constantFrom(...TOUR_BLOCK_VIEWS.longText),
      body,
    })
    .map(({ view, body: text }) => longTextBlock(view, text)),
  fc.constantFrom<TourBlock>(
    {
      id: "p",
      kind: "shortText",
      view: "pin",
      caption: "Sign",
      pose: POSE,
    } as TourBlock,
    {
      id: "q",
      kind: "picture",
      view: "plane",
      image: "a",
      widthM: 1,
      pose: POSE,
    } as TourBlock,
  ),
);

/** Stored values: anything, and well-formed values with any view names. */
const viewName = fc.oneof(
  { arbitrary: fc.constantFrom("reading", "lectern"), weight: 4 },
  fc.constantFrom("card", "captions", "silent", "pin"),
  fc.string({ maxLength: 8 }),
);
const stored = fc.oneof(
  fc.anything(),
  // The long text's own entry, so a real choice is drawn often.
  viewName.map((world) => ({ views: { longText: { world } } })),
  fc.record(
    {
      views: fc.dictionary(
        fc.constantFrom("longText", "picture", "video", "x"),
        fc.oneof(
          fc.dictionary(fc.constantFrom("world", "screen", "air"), viewName),
          fc.anything(),
        ),
      ),
      videoSound: fc.constantFrom("on", "off"),
    },
    { requiredKeys: [] },
  ),
);

const audience = fc.constantFrom("visitor" as const, "creator" as const);

describe("the preference function's promises", () => {
  // Why this test matters: a view whose needs fail would drop content (a
  // lectern losing a body's pictures); the switch must never cause that.
  it("shows a view whose needs hold, in the creator's view's placement", () => {
    fc.assert(
      fc.property(audience, block, stored, (who, b, s) => {
        const shown = shownView({ audience: who, block: b, stored: s });
        const set = viewSetOf(b.kind, b.view);
        // A creator, and a view in no set: the creator's own view. Else
        // its needs hold, and it never moves a block between the world
        // and the screen.
        const holds =
          who === "creator" || set === null
            ? shown === b.view
            : viewNeedsFail(b, shown) === null &&
              viewSetOf(b.kind, shown)?.placement === set.placement &&
              set.members.includes(shown);
        expect(holds, `${who} ${b.view} shows ${shown}`).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  // Why this test matters: a read must never write (the value may belong
  // to a newer app sharing the storage, design §4).
  it("never rewrites the stored value by reading it", () => {
    fc.assert(
      fc.property(audience, block, stored, (who, b, s) => {
        const before: unknown = structuredClone(s);
        shownView({ audience: who, block: b, stored: s });
        preferredView(s, b.kind, "world");
        expect(s).toEqual(before);
      }),
      { numRuns: 1000 },
    );
  });

  // Why this test matters: a choice set and then read back is what shows,
  // whenever its needs hold - the switch does what it says.
  it("shows a chosen member whenever its needs hold", () => {
    fc.assert(
      fc.property(
        block,
        stored,
        fc.constantFrom("reading", "lectern"),
        (b, s, v) => {
          const set = viewSetOf(b.kind, b.view);
          fc.pre(set !== null);
          const next = withPreferredView(s, b.kind, "world", v);
          const shown = shownView({
            audience: "visitor",
            block: b,
            stored: next,
          });
          const holds =
            viewNeedsFail(b, v) === null ? shown === v : shown !== v;
          expect(holds, `${v} chosen, ${shown} shown`).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
