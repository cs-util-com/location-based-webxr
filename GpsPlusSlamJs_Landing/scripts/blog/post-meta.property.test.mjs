import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parsePost } from "./post-meta.mjs";

// Why this test matters: the example tests cover the pages we thought of. The
// gate's real job is to hold for the page nobody thought of — a half-pasted
// draft, a page whose name is punctuation, a meta block with the keyword in a
// value rather than the status. These properties state the invariants that
// must survive ANY input, because "published" is the one outcome that cannot
// be taken back.
//
// EVERY GENERATOR HERE IS BUILT, NOT FREE-FORM, AND THAT IS THE POINT. An
// earlier version of this file generated a random string as the page body;
// a random string never contains a valid `blog-meta` block, so the published
// branch was reached ZERO times in 20 000 runs and every property was a green
// assertion about the empty set. One property was rewritten when that was
// found; the other three were not, and a cold review measured them still
// vacuous. The lesson generalises: a property over gated input asserts nothing
// until you have confirmed it reaches the branch it guards.

/** Status values that must publish, and values that must not. */
const ACCEPTED = ["published", "Published", "PUBLISHED", "  published  "];
const REJECTED = [
  "publish",
  "published tomorrow",
  "unpublished",
  "draft",
  "",
  "pubished",
];

/** A status value drawn from both sides, plus genuinely arbitrary text. */
const statusArb = fc.oneof(
  fc.constantFrom(...ACCEPTED),
  fc.constantFrom(...REJECTED),
  fc.string(),
);

/** @param {string} status @param {string} body */
const page = (status, body) =>
  `<!--\nblog-meta\nstatus: ${status.replace(/[\n\r]/g, " ")}\ndate: 2026-08-20\n-->\n${body}`;

describe("parsePost — invariants under arbitrary input", () => {
  it("never throws, on arbitrary content or on a well-formed page", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), statusArb, (name, body, status) => {
        expect(() => parsePost(`${name}.md`, body)).not.toThrow();
        expect(() => parsePost(`${name}.md`, page(status, body))).not.toThrow();
      }),
    );
  });

  it("only ever publishes a post that is safe to put on a URL", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (fileName, bodyText) => {
        const post = parsePost(`${fileName}.md`, page("published", bodyText));
        if (post.status !== "published") {
          return;
        }
        // A published post is linked, listed and put in the sitemap; each of
        // these would produce a broken URL or a malformed sitemap entry.
        expect(post.slug).not.toBe("");
        expect(post.slug).toMatch(/^[a-z0-9-]+$/);
        expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }),
    );
  });

  it("publishes only on the exact keyword, never on something containing it", () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const post = parsePost(
          "A-page.md",
          page(status, "# A page\n\nBody.\n"),
        );
        // Oracle by a DIFFERENT mechanism than the implementation's
        // trim/lowercase/compare — a test that restates the code cannot fail
        // when the code is wrong.
        const isKeyword = /^\s*published\s*$/i.test(status);
        expect(post.status === "published").toBe(isKeyword);
      }),
    );
  });

  it("reports a reason exactly when it withholds publication", () => {
    fc.assert(
      fc.property(fc.string(), statusArb, (bodyText, status) => {
        const post = parsePost("A-page.md", page(status, bodyText));
        // A silent draft is unactionable: the author sees nothing on the site
        // and nothing in the build log explaining why. The converse matters
        // too — a published post carrying a draftReason would mean the gate
        // decided one way and reported the other.
        expect(typeof post.draftReason === "string").toBe(
          post.status === "draft",
        );
      }),
    );
  });

  it("reaches BOTH branches — the guard against this file going vacuous again", () => {
    // Not a property of parsePost: a property of the generators above. If this
    // ever fails, the properties above have stopped testing what they claim,
    // and they will keep passing while they do it.
    let published = 0;
    let draft = 0;
    fc.assert(
      fc.property(statusArb, (status) => {
        const post = parsePost("A-page.md", page(status, "Body."));
        if (post.status === "published") {
          published += 1;
        } else {
          draft += 1;
        }
      }),
      { numRuns: 500 },
    );
    expect(published).toBeGreaterThan(20);
    expect(draft).toBeGreaterThan(20);
  });
});
