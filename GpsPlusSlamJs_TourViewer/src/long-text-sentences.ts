/**
 * The sentences of a rendered long text: where each one starts and ends
 * in the sheet's DOM, as `Range`s over its text nodes, so the reading
 * mark can be drawn over a sentence (the CSS Custom Highlight API) and a
 * tap can be turned into the sentence under it - without wrapping a
 * sentence in an element of its own, which the renderer's fixed element
 * list (`long-text-render.ts`) would not allow.
 *
 * @see long-text-sentences.ts.md
 */

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
 *  of `.`, `!` or `?` and any closing quotes or brackets after it. */
const FALLBACK = /[^.!?]*(?:[.!?]+["'’”)\]]*|$)/gu;

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

/** One sentence of the sheet: its text in the DOM and the paragraph
 *  (block of text) it belongs to, counted from 0. */
export interface SheetSentence {
  readonly range: Range;
  readonly paragraph: number;
}

export interface SentenceIndex {
  readonly sentences: readonly SheetSentence[];
  /** How many blocks of text hold at least one sentence. */
  readonly paragraphs: number;
  /** The first sentence of each such block. */
  readonly paragraphStarts: readonly number[];
}

/** The blocks of text a rendered body is read in: its paragraphs and
 *  headings (list items and quotes hold paragraphs of their own). */
const TEXT_BLOCKS = "p, h3, h4, h5";

/**
 * The sentences of the body rendered under `root`, in reading order.
 * `skip` names blocks that are not read (a picture's holder). A block's
 * text is the text of all its text nodes, so a sentence may run across
 * an emphasis or a link.
 */
export function indexSentences(
  root: Element,
  skip: ReadonlySet<Element>,
  lang = "en",
): SentenceIndex {
  const doc = root.ownerDocument;
  const sentences: SheetSentence[] = [];
  const paragraphStarts: number[] = [];
  for (const block of root.querySelectorAll(TEXT_BLOCKS)) {
    if (skip.has(block)) continue;
    const nodes: { readonly node: Text; readonly start: number }[] = [];
    let text = "";
    const walker = doc.createTreeWalker(block, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const t = n as Text;
      nodes.push({ node: t, start: text.length });
      text += t.data;
    }
    const spans = sentenceSpans(text, lang);
    if (spans.length === 0) continue;
    // A point in the block's text as a (node, offset) pair: the first
    // node whose text reaches it.
    const at = (offset: number): { node: Text; offset: number } => {
      for (const { node, start } of nodes) {
        if (offset <= start + node.data.length) {
          return { node, offset: offset - start };
        }
      }
      const last = nodes[nodes.length - 1];
      return last === undefined
        ? { node: doc.createTextNode(""), offset: 0 }
        : { node: last.node, offset: last.node.data.length };
    };
    paragraphStarts.push(sentences.length);
    const paragraph = paragraphStarts.length - 1;
    for (const span of spans) {
      // A start at a node's very end belongs to the next node.
      let start = at(span.from);
      if (start.offset === start.node.data.length) {
        const next = nodes.find((n) => n.start === span.from);
        if (next !== undefined) start = { node: next.node, offset: 0 };
      }
      const end = at(span.to);
      const range = doc.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      sentences.push({ range, paragraph });
    }
  }
  return {
    sentences,
    paragraphs: paragraphStarts.length,
    paragraphStarts,
  };
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
