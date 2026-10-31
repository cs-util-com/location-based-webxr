// @vitest-environment jsdom
/**
 * Why this test matters: the sheet's reading mark and a tap on a sentence
 * both rest on this index. A sentence range that starts in the wrong text
 * node, or a picture's alt text counted as a sentence, puts the mark on
 * the wrong words and the readout ("Sentence 3 of 12") out of step with
 * what the visitor sees.
 */
import { describe, expect, it, vi } from "vitest";

import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

import { placeLeaves } from "./long-text-leaves.js";
import { renderLongText } from "./long-text-render.js";
import {
  indexSentences,
  plainSentences,
  sentenceAt,
  sentenceHolding,
  sentenceSpans,
} from "./long-text-sentences.js";

function texts(text: string): string[] {
  return sentenceSpans(text).map((s) => text.slice(s.from, s.to));
}

function rendered(body: string) {
  const host = document.createElement("article");
  const doc = parseTourMarkdown(body);
  const out = renderLongText(doc, {
    document,
    onLinkTap: () => undefined,
  });
  host.appendChild(out.fragment);
  document.body.replaceChildren(host);
  const plain = plainTextOf(doc);
  const leaves = placeLeaves(plain, out.leaves);
  return {
    host,
    plain: plain.text,
    index: indexSentences(document, plain.text, leaves),
  };
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
      // A hard break's line break ends a sentence, as the segmenter's does.
      const lines = "Market Street 4\nOpen from nine";
      expect(
        m.sentenceSpans(lines).map((s) => lines.slice(s.from, s.to)),
      ).toEqual(["Market Street 4", "Open from nine"]);
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

  // Why this test matters: a hard break ends a line the writer meant to
  // stand alone (an address, a verse); with nothing added for it the two
  // lines' words run together ("...Street 4Open from...") and the mark
  // covers both as one sentence.
  it("ends a sentence at a hard break, not gluing the two lines", () => {
    const { index } = rendered("Market Street 4  \nOpen from nine");
    expect(index.sentences.map((s) => s.range.toString())).toEqual([
      "Market Street 4",
      "Open from nine",
    ]);
    expect(index.paragraphs).toBe(1);
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

describe("sentences cut from the plain text", () => {
  // Why this test matters: a read-along timing counts in offsets of the
  // narrator's plain text P. Sentences cut from the page's DOM text (with
  // a link's host in it) would sit at other offsets than the timing's, and
  // the voice's sentence would be marked one stretch off after every link.
  it("gives each sentence its stretch of P, the link host not counted", () => {
    const { index, plain } = rendered(
      "See [the map](https://example.org/map) here. Then *walk* on.\n\n## Inside\n\nThe hall.",
    );
    expect(index.sentences.map((s) => plain.slice(s.from, s.to))).toEqual([
      "See the map here.",
      "Then walk on.",
      "Inside",
      "The hall.",
    ]);
    // The page's own range still spans what the visitor sees.
    expect(index.sentences[0]?.range.toString()).toBe(
      "See the map (example.org) here.",
    );
  });

  // Why this test matters: the captions strip follows the voice by the
  // same sentences the sheet marks, without a DOM; a cut that differed
  // would show one sentence in the strip while the sheet marks another.
  it("cuts the same sentences without a DOM", () => {
    const body =
      "See [the map](https://example.org/map) here. Then *walk* on.\n\n## Inside\n\nThe hall.";
    const { index, plain } = rendered(body);
    const p = plainTextOf(parseTourMarkdown(body));
    expect(plainSentences(p.text, p.leaves)).toEqual(
      index.sentences.map((s) => ({ from: s.from, to: s.to })),
    );
    expect(plain).toBe(p.text);
    expect(plainSentences("", [])).toEqual([]);
  });

  it("finds the sentence holding an offset, the one before a gap, and -1 before all", () => {
    const { index, plain } = rendered("One two. Three four.\n\nFive six.");
    expect(sentenceHolding(index, 0)).toBe(0);
    expect(sentenceHolding(index, plain.indexOf("Three"))).toBe(1);
    // The space between two sentences, and the blank line between leaves.
    expect(sentenceHolding(index, plain.indexOf(" Three"))).toBe(0);
    expect(sentenceHolding(index, plain.indexOf("\n\n") + 1)).toBe(1);
    expect(sentenceHolding(index, plain.length + 5)).toBe(2);
    expect(sentenceHolding(index, -1)).toBe(-1);
    expect(sentenceHolding(index, Number.NaN)).toBe(-1);
    expect(sentenceHolding({ sentences: [] }, 3)).toBe(-1);
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
