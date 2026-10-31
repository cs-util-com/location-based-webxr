// @vitest-environment jsdom
/**
 * Why this test matters: the read-along's promise is that the span marked
 * for any offset of P is the one leaf range holding it. For any body made
 * of paragraphs, headings, lists, quotes, emphasis, links, soft and hard
 * breaks and pictures, every offset inside a leaf must find that leaf and
 * mark exactly its own character there (a hard break's marks nothing),
 * inside that leaf's element; every offset between leaves finds none.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

import { leafAt, placeLeaves, rangeOf } from "./long-text-leaves.js";
import { renderLongText } from "./long-text-render.js";

const WORDS = ["hall", "Old", "été", "1612.", "door,", "“Why?”", "a", "x_y"];
const inline = fc.oneof(
  fc.constantFrom(...WORDS),
  fc.constantFrom(...WORDS).map((w) => `*${w}*`),
  fc.constantFrom(...WORDS).map((w) => `**${w}**`),
  fc
    .constantFrom(...WORDS)
    .map((w) => `[${w}](https://example.org/${w.length})`),
  fc.constant("![inline](asset:p)"),
);
const line = fc
  .array(inline, { minLength: 1, maxLength: 6 })
  .map((ws) => ws.join(" "));
const paragraph = fc
  .array(fc.tuple(line, fc.constantFrom("\n", "  \n")), {
    minLength: 1,
    maxLength: 3,
  })
  .map((ls) =>
    ls.map(([l, br], i) => (i < ls.length - 1 ? l + br : l)).join(""),
  );
const block = fc.oneof(
  paragraph,
  line.map((l) => `## ${l}`),
  fc
    .array(line, { minLength: 1, maxLength: 3 })
    .map((ls) => ls.map((l) => `- ${l}`).join("\n")),
  paragraph.map((p) => `> ${p.replace(/\n/gu, "\n> ")}`),
  fc.constant("![A picture](asset:front)"),
);
const body = fc
  .array(block, { minLength: 1, maxLength: 6 })
  .map((bs) => bs.join("\n\n"));

describe("the span for any offset (property)", () => {
  it("is the one leaf range holding it", () => {
    fc.assert(
      fc.property(body, (md) => {
        const doc = parseTourMarkdown(md);
        const out = renderLongText(doc, {
          document,
          onLinkTap: () => undefined,
        });
        const host = document.createElement("article");
        host.appendChild(out.fragment);
        document.body.replaceChildren(host);
        const plain = plainTextOf(doc);
        const leaves = placeLeaves(plain, out.leaves);
        // Every leaf of P is placed.
        expect(leaves.map((l) => [l.from, l.to])).toEqual(
          plain.leaves.map((l) => [l.from, l.to]),
        );
        const P = plain.text;
        // Per offset: the leaf holding it, and the one-character range's
        // place and text - computed, then compared whole against what the
        // plain text's own leaves say.
        const got: unknown[] = [];
        const want: unknown[] = [];
        for (let p = 0; p <= P.length; p += 1) {
          const holder = plain.leaves.findIndex((l) => l.from <= p && p < l.to);
          const r = rangeOf(document, leaves, p, p + 1);
          const leaf = leaves[holder];
          got.push({
            p,
            leaf: leafAt(leaves, p),
            range:
              r === null
                ? null
                : {
                    inLeaf:
                      leaf?.element.contains(r.commonAncestorContainer) ??
                      false,
                    text: r.toString(),
                  },
          });
          want.push({
            p,
            leaf: holder,
            range:
              holder < 0
                ? null
                : {
                    inLeaf: true,
                    text: P.charAt(p) === "\n" ? "" : P.charAt(p),
                  },
          });
        }
        expect(got).toEqual(want);
      }),
      { numRuns: 40 },
    );
  });
});
