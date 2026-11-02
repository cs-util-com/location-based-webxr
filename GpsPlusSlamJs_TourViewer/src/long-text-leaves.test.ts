// @vitest-environment jsdom
/**
 * Why this test matters: a read-along timing names stretches of the plain
 * text P by offset; the sheet marks them on the page. If an offset maps to
 * the wrong text node, or a mark runs on into the next paragraph, the
 * visitor sees the voice's word one word off, or a whole paragraph lit.
 */
import { describe, expect, it } from "vitest";

import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

import { leafAt, placeLeaves, rangeOf } from "./long-text-leaves.js";
import { renderLongText } from "./long-text-render.js";

function laid(body: string) {
  const doc = parseTourMarkdown(body);
  const out = renderLongText(doc, { document, onLinkTap: () => undefined });
  const host = document.createElement("article");
  host.appendChild(out.fragment);
  document.body.replaceChildren(host);
  const plain = plainTextOf(doc);
  return { plain, leaves: placeLeaves(plain, out.leaves) };
}

describe("placeLeaves", () => {
  it("places every leaf of P, in order", () => {
    const { plain, leaves } = laid(
      "# Title\n\nOne *two*.\n\n- Item\n\n> Quote\n\n![Alt](asset:a)",
    );
    expect(leaves.map((l) => plain.text.slice(l.from, l.to))).toEqual([
      "Title",
      "One two.",
      "Item",
      "Quote",
    ]);
    expect(leaves.map((l) => l.element.tagName)).toEqual(["H3", "P", "P", "P"]);
  });

  it("leaves out a leaf the render does not hold, or holds with other text", () => {
    // Why: a render of another body must mark nothing rather than wrong words.
    const doc = parseTourMarkdown("Alpha.\n\nBeta.");
    const other = renderLongText(parseTourMarkdown("Gamma.\n\nBeta."), {
      document,
      onLinkTap: () => undefined,
    });
    expect(placeLeaves(plainTextOf(doc), other.leaves)).toEqual([]);
    const own = renderLongText(doc, { document, onLinkTap: () => undefined });
    const firstOnly = new Map([...own.leaves].slice(0, 1));
    expect(placeLeaves(plainTextOf(doc), firstOnly)).toHaveLength(1);
  });
});

describe("leafAt and rangeOf", () => {
  it("maps an offset to its leaf, -1 in the blank line between leaves", () => {
    const { plain, leaves } = laid("One two.\n\nThree.");
    expect(leafAt(leaves, 0)).toBe(0);
    expect(leafAt(leaves, 7)).toBe(0);
    expect(leafAt(leaves, 8)).toBe(-1);
    expect(leafAt(leaves, 9)).toBe(-1);
    expect(leafAt(leaves, 10)).toBe(1);
    expect(leafAt(leaves, plain.text.length)).toBe(-1);
    expect(leafAt(leaves, Number.NaN)).toBe(-1);
  });

  it("marks a word across emphasis and after a link, not the link's host", () => {
    const { plain, leaves } = laid(
      "Go *to the* [old](https://example.org) hall now.",
    );
    const at = (w: string) => {
      const i = plain.text.indexOf(w);
      return rangeOf(document, leaves, i, i + w.length)?.toString();
    };
    expect(at("to the")).toBe("to the");
    expect(at("old")).toBe("old");
    expect(at("hall")).toBe("hall");
  });

  it("clips a stretch to the leaf holding its start", () => {
    const { plain, leaves } = laid("One two.\n\nThree.");
    expect(rangeOf(document, leaves, 4, plain.text.length)?.toString()).toBe(
      "two.",
    );
  });

  it("is null for an empty stretch or a start in no leaf", () => {
    const { leaves } = laid("One two.\n\nThree.");
    expect(rangeOf(document, leaves, 3, 3)).toBeNull();
    expect(rangeOf(document, leaves, 8, 12)).toBeNull();
    expect(rangeOf(document, [], 0, 2)).toBeNull();
  });

  it("starts a line after a hard break in its own node", () => {
    const { plain, leaves } = laid("Market Street 4  \nOpen from nine");
    const i = plain.text.indexOf("Open");
    const r = rangeOf(document, leaves, i, i + 4);
    expect(r?.toString()).toBe("Open");
    // The break's own character is in no node: it marks nothing.
    const br = plain.text.indexOf("\n");
    expect(rangeOf(document, leaves, br, br + 1)?.toString()).toBe("");
  });
});
