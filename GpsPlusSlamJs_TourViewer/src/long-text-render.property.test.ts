// @vitest-environment jsdom
/**
 * Why this test matters: the body is any text a tour's maker typed, and
 * the renderer's promise is that whatever it is, the page gets only the
 * allowlisted elements and attributes - never markup from the text
 * itself. Hand-written cases cover the forms we thought of; this throws
 * generated bodies built from the characters Markdown and HTML care about
 * at it, so a form nobody thought of cannot slip a tag or an attribute
 * through.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseTourMarkdown } from "gps-plus-slam-app-framework/ar/tour-markdown";

import { LONG_TEXT_ALLOWED, renderLongText } from "./long-text-render.js";

const PIECES = [
  "# ",
  "## ",
  "- ",
  "1. ",
  "> ",
  "*",
  "**",
  "_",
  "[",
  "](",
  ")",
  "![",
  "asset:mill",
  "https://town.example/a",
  "javascript:alert(1)",
  "<b>",
  "<script>",
  '" onclick="x',
  "&amp;",
  "\\",
  "  \n",
  "\n",
  "\n\n",
  "   ",
  "word",
  "Mühle",
];

const body = fc
  .array(fc.oneof(fc.constantFrom(...PIECES), fc.string({ maxLength: 4 })), {
    maxLength: 40,
  })
  .map((parts) => parts.join(""));

describe("renderLongText (property)", () => {
  it("emits only allowlisted elements and attributes, whatever the body", () => {
    fc.assert(
      fc.property(body, (text) => {
        const host = document.createElement("div");
        const out = renderLongText(parseTourMarkdown(text), {
          document,
          onLinkTap: () => undefined,
        });
        host.append(out.fragment);
        for (const el of host.querySelectorAll("*")) {
          const allowed = LONG_TEXT_ALLOWED[el.localName];
          expect(allowed, el.localName).toBeDefined();
          for (const attr of el.getAttributeNames()) {
            expect(allowed).toContain(attr);
          }
        }
        for (const a of host.querySelectorAll("a")) {
          expect(a.getAttribute("href")).toMatch(/^https:\/\//);
        }
        for (const slot of out.pictures) {
          expect(host.contains(slot.holder)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
