/**
 * The sentences of a rendered long text: where each one starts and ends
 * in its plain text `P` and in the sheet's DOM, as `Range`s over its
 * text nodes, so the reading
 * mark can be drawn over a sentence (the CSS Custom Highlight API) and a
 * tap can be turned into the sentence under it - without wrapping a
 * sentence in an element of its own, which the renderer's fixed element
 * list (`long-text-render.ts`) would not allow.
 *
 * @see long-text-sentences.ts.md
 */

import { lastAtOrBefore } from "./last-at-or-before.js";
import { rangeOf, type PlacedLeaf } from "./long-text-leaves.js";

/** A stretch of a string, `from` inclusive, `to` exclusive. */
export interface TextSpan {
  readonly from: number;
  readonly to: number;
}

type SentenceSegmenter = new (
  lang: string,
  options: { granularity: "sentence" },
) => { segment(text: string): Iterable<{ segment: string; index: number }> };

const SEGMENTER = (Intl as unknown as { Segmenter?: SentenceSegmenter })
  .Segmenter;

/** Ends of sentences where the browser has no sentence segmenter: a run
 *  of `.`, `!` or `?` and any closing quotes or brackets after it, or a line
 *  break (a hard break; the segmenter ends a sentence there too). */
const FALLBACK = /[^.!?\n]*(?:\n|[.!?]+["'’”)\]]*|$)/gu;

function segments(text: string, lang: string): TextSpan[] {
  if (SEGMENTER !== undefined) {
    let segmenter: InstanceType<SentenceSegmenter>;
    try {
      segmenter = new SEGMENTER(lang, { granularity: "sentence" });
    } catch {
      // A malformed `lang`: the default rules are close enough.
      segmenter = new SEGMENTER("en", { granularity: "sentence" });
    }
    return [...segmenter.segment(text)].map((s) => ({
      from: s.index,
      to: s.index + s.segment.length,
    }));
  }
  const out: TextSpan[] = [];
  for (const m of text.matchAll(FALLBACK)) {
    if (m[0] === "") continue;
    out.push({ from: m.index, to: m.index + m[0].length });
  }
  return out;
}

/**
 * The sentences of `text`, in order, each trimmed of white space; a
 * sentence of white space only is left out. Never throws.
 */
export function sentenceSpans(text: string, lang = "en"): TextSpan[] {
  if (typeof text !== "string" || text === "") return [];
  const out: TextSpan[] = [];
  for (const { from, to } of segments(text, lang)) {
    let a = from;
    let b = to;
    while (a < b && /\s/u.test(text.charAt(a))) a += 1;
    while (b > a && /\s/u.test(text.charAt(b - 1))) b -= 1;
    if (b > a) out.push({ from: a, to: b });
  }
  return out;
}

/**
 * The sentences of a plain text `P`, cut leaf by leaf (`leaves` are its
 * paragraphs' and headings' stretches, `plainTextOf(...).leaves`), in
 * order: the same cut `indexSentences` makes, without a DOM - what the
 * captions strip follows the voice by.
 */
export function plainSentences(
  plainText: string,
  leaves: readonly TextSpan[],
  lang = "en",
): TextSpan[] {
  const out: TextSpan[] = [];
  for (const leaf of leaves) {
    for (const span of sentenceSpans(
      plainText.slice(leaf.from, leaf.to),
      lang,
    )) {
      out.push({ from: leaf.from + span.from, to: leaf.from + span.to });
    }
  }
  return out;
}

/** One sentence of the sheet: its stretch of `P`, its words in the
 *  DOM, and the paragraph (leaf) it belongs to, counted from 0. */
interface SheetSentence {
  readonly from: number;
  readonly to: number;
  readonly range: Range;
  readonly paragraph: number;
}

export interface SentenceIndex {
  readonly sentences: readonly SheetSentence[];
  /** How many leaves (paragraphs and headings) hold at least one
   *  sentence. */
  readonly paragraphs: number;
  /** The first sentence of each such leaf. */
  readonly paragraphStarts: readonly number[];
}

/**
 * The sentences of a rendered body, in reading order, cut from its plain
 * text `P` (`plainText`, the narrator's text) leaf by leaf, so a
 * sentence's offsets are the ones a read-along timing counts in. A
 * sentence never runs from one paragraph or heading into the next; it
 * may run across an emphasis or a link (its range then covers the host
 * shown beside the link). A hard break is a line break in `P`, which ends
 * a sentence, so two lines are never read as one. Pictures are in no
 * leaf.
 */
export function indexSentences(
  doc: Document,
  plainText: string,
  leaves: readonly PlacedLeaf[],
  lang = "en",
): SentenceIndex {
  const sentences: SheetSentence[] = [];
  const paragraphStarts: number[] = [];
  for (const leaf of leaves) {
    const first = sentences.length;
    const paragraph = paragraphStarts.length;
    const text = plainText.slice(leaf.from, leaf.to);
    for (const span of sentenceSpans(text, lang)) {
      const from = leaf.from + span.from;
      const to = leaf.from + span.to;
      const range = rangeOf(doc, [leaf], from, to);
      if (range !== null) sentences.push({ from, to, range, paragraph });
    }
    if (sentences.length > first) paragraphStarts.push(first);
  }
  return {
    sentences,
    paragraphs: paragraphStarts.length,
    paragraphStarts,
  };
}

/**
 * The sentence holding offset `at` of `P`, or, between two sentences,
 * the one before it; -1 before the first or with none. A binary search,
 * so a read-along can ask on every frame.
 */
export function sentenceHolding(
  index: { readonly sentences: readonly TextSpan[] },
  at: number,
): number {
  if (!Number.isFinite(at)) return -1;
  return lastAtOrBefore(index.sentences, (s) => s.from, at);
}

/**
 * The sentence at a point of the DOM (a tap's caret position): the one
 * containing it, or, between two sentences, the one before it; the first
 * for a point before them all, the last for one after; null when there
 * are none or the point is not comparable with them.
 */
export function sentenceAt(
  index: Pick<SentenceIndex, "sentences">,
  node: Node,
  offset: number,
): number | null {
  const { sentences } = index;
  if (sentences.length === 0) return null;
  try {
    for (let i = 0; i < sentences.length; i += 1) {
      const where = sentences[i]?.range.comparePoint(node, offset) ?? 1;
      if (where === 0) return i;
      if (where < 0) return i === 0 ? 0 : i - 1;
    }
  } catch {
    return null;
  }
  return sentences.length - 1;
}
