// @vitest-environment jsdom
/**
 * Why this test matters: the sheet's reading mark and a tap on a sentence
 * both rest on this index. A sentence range that starts in the wrong text
 * node, or a picture's alt text counted as a sentence, puts the mark on
 * the wrong words and the readout ("Sentence 3 of 12") out of step with
 * what the visitor sees.
 */
import { describe, expect, it, vi } from "vitest";

import { parseTourMarkdown } from "gps-plus-slam-app-framework/ar/tour-markdown";

import { renderLongText } from "./long-text-render.js";
import {
  indexSentences,
  sentenceAt,
  sentenceSpans,
} from "./long-text-sentences.js";

function texts(text: string): string[] {
  return sentenceSpans(text).map((s) => text.slice(s.from, s.to));
}

function rendered(body: string) {
  const host = document.createElement("article");
  const out = renderLongText(parseTourMarkdown(body), {
    document,
    onLinkTap: () => undefined,
  });
  host.appendChild(out.fragment);
  document.body.replaceChildren(host);
  const skip = new Set<Element>(out.pictures.map((p) => p.holder));
  return { host, index: indexSentences(host, skip) };
}

describe("sentenceSpans", () => {
  it("splits sentences and trims the white space between them", () => {
    expect(texts("The hall burned. It was built again!  Was it?")).toEqual([
      "The hall burned.",
      "It was built again!",
      "Was it?",
    ]);
  });

  it("gives nothing for empty or white-space-only text", () => {
    expect(sentenceSpans("")).toEqual([]);
    expect(sentenceSpans("   \n ")).toEqual([]);
  });

  it("survives a malformed language tag", () => {
    expect(sentenceSpans("One. Two.", "not a tag!").length).toBe(2);
  });
});

describe("sentenceSpans without a sentence segmenter", () => {
  // Older browsers have no Intl.Segmenter: the fallback must still split.
  it("splits at full stops, question and exclamation marks", async () => {
    const intl = Intl as unknown as { Segmenter?: unknown };
    const saved = intl.Segmenter;
    intl.Segmenter = undefined;
    vi.resetModules();
    try {
      const m = await import("./long-text-sentences.js");
      const text = "The hall burned. “Why?”  It was rebuilt";
      expect(
        m.sentenceSpans(text).map((s) => text.slice(s.from, s.to)),
      ).toEqual(["The hall burned.", "“Why?”", "It was rebuilt"]);
    } finally {
      intl.Segmenter = saved;
      vi.resetModules();
    }
  });
});

describe("indexSentences", () => {
  it("indexes paragraphs and headings in reading order, across emphasis and links", () => {
    const { index } = rendered(
      "# The square\n\nThe *old* hall burned. See [the map](https://example.org/map) here.\n\n- A door. A window.",
    );
    expect(index.sentences.map((s) => s.range.toString())).toEqual([
      "The square",
      "The old hall burned.",
      "See the map (example.org) here.",
      "A door.",
      "A window.",
    ]);
    expect(index.sentences.map((s) => s.paragraph)).toEqual([0, 1, 1, 2, 2]);
    expect(index.paragraphs).toBe(3);
    expect(index.paragraphStarts).toEqual([0, 1, 3]);
  });

  it("leaves a picture's holder out", () => {
    const { index } = rendered(
      "Before it.\n\n![The guild house](asset:front)\n\nAfter it.",
    );
    expect(index.sentences.map((s) => s.range.toString())).toEqual([
      "Before it.",
      "After it.",
    ]);
    expect(index.paragraphs).toBe(2);
  });

  it("starts a sentence in the node its first letter is in", () => {
    // "One." ends the first text node exactly; "Two" starts inside <em>.
    const { index } = rendered("One. *Two* three.");
    const second = index.sentences[1]?.range;
    expect(second?.toString()).toBe("Two three.");
    expect(second?.startContainer.parentElement?.tagName).toBe("EM");
  });
});

describe("sentenceAt", () => {
  it("finds the sentence under a point, the one before a gap, and the ends", () => {
    const { host, index } = rendered("One two. Three four.\n\nFive six.");
    const first = host.querySelector("p")?.firstChild;
    if (!(first instanceof Text)) throw new Error("no text");
    expect(sentenceAt(index, first, 2)).toBe(0);
    expect(sentenceAt(index, first, 12)).toBe(1);
    // The space between the two sentences belongs to the one before it.
    expect(sentenceAt(index, first, 8)).toBe(0);
    const last = host.querySelectorAll("p")[1]?.firstChild;
    if (!(last instanceof Text)) throw new Error("no text");
    expect(sentenceAt(index, last, 9)).toBe(2);
    // Before them all, and after them all.
    expect(sentenceAt(index, host, 0)).toBe(0);
    expect(sentenceAt(index, document.body, 1)).toBe(2);
  });

  it("is null with no sentences, and for a point in another document", () => {
    const { index } = rendered("Words.");
    expect(sentenceAt({ sentences: [] }, document.body, 0)).toBeNull();
    const other = document.implementation.createHTMLDocument("");
    expect(sentenceAt(index, other.body, 0)).toBeNull();
  });
});
