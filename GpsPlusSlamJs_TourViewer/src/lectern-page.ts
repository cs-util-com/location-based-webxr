/**
 * The reading stand's page (a long text's `lectern` view, `tour.json`
 * minor 3), as numbers: the text's paragraphs and sentences, one
 * paragraph wrapped into lines, the nine-line window around the current
 * sentence and the page turn a tap makes. The rules are the prototype's
 * (`public/prototypes/station-blocks-1-narrated-text/`, the lectern); the
 * drawing is `lectern-view.ts`'s.
 *
 * Pure: the width of a word comes from `measure` (a canvas's
 * `measureText` on the page, a stub under test).
 *
 * @see lectern-page.ts.md
 */

/** The page as the prototype draws it, in canvas pixels. */
export const LECTERN_PAGE = {
  widthPx: 1024,
  heightPx: 768,
  /** Lines shown at once. */
  rows: 9,
  /** The window starts this many lines above the current sentence. */
  leadLines: 2,
  /** A tap moves the page on by this many lines. */
  turnLines: 7,
  marginPx: 62,
  firstBaselinePx: 206,
  lineStepPx: 54,
  lineWidthPx: 900,
} as const;

export interface LecternParagraph {
  readonly from: number;
  readonly to: number;
  /** Its first sentence's index, and one past its last. */
  readonly s0: number;
  readonly s1: number;
}

export interface LecternSentence {
  readonly from: number;
  readonly to: number;
  /** Its paragraph's index. */
  readonly p: number;
}

/** A text as the stand reads it: offsets into `text`. */
export interface LecternText {
  readonly text: string;
  readonly paragraphs: readonly LecternParagraph[];
  readonly sentences: readonly LecternSentence[];
}

/** One word of a wrapped line: its offsets in the text, its x from the
 *  line's start and its width, in `measure`'s units. */
export interface LecternToken {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly x: number;
  readonly w: number;
}

const BLANK_LINE = /\n[ \t]*\n/g;
/** A sentence's end: one or more of `.!?…`, closing quotes or brackets,
 *  then a space or the paragraph's end. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
/** What may start the next sentence. */
const SENTENCE_START = /[\p{Lu}\p{N}"'“‘([]/u;
const SPACE = /\s/;

function trimmed(text: string, from: number, to: number): [number, number] {
  let a = from;
  let b = to;
  while (a < b && SPACE.test(text.charAt(a))) a += 1;
  while (b > a && SPACE.test(text.charAt(b - 1))) b -= 1;
  return [a, b];
}

/**
 * Paragraphs a blank line apart and their sentences. A sentence ends at a
 * `.`, `!`, `?` or `…` (closing quotes and brackets included) followed by
 * a capital, a digit or an opening quote, or at the paragraph's end; so
 * "e.g. this" stays one sentence. A text that is not a string reads as
 * empty.
 */
export function analyzeLecternText(text: string): LecternText {
  const body = typeof text === "string" ? text : "";
  const cuts: [number, number][] = [];
  let start = 0;
  for (const m of body.matchAll(BLANK_LINE)) {
    cuts.push([start, m.index]);
    start = m.index + m[0].length;
  }
  cuts.push([start, body.length]);
  const paragraphs: LecternParagraph[] = [];
  const sentences: LecternSentence[] = [];
  for (const [from, to] of cuts) {
    const [a, b] = trimmed(body, from, to);
    if (b <= a) continue;
    const p = paragraphs.length;
    const s0 = sentences.length;
    const push = (x: number, y: number): void => {
      const [sa, sb] = trimmed(body, x, y);
      if (sb > sa) sentences.push({ from: sa, to: sb, p });
    };
    const t = body.slice(a, b);
    let last = 0;
    for (const m of t.matchAll(SENTENCE_END)) {
      const end = m.index + m[0].length;
      let k = end;
      while (k < t.length && SPACE.test(t.charAt(k))) k += 1;
      if (k >= t.length || SENTENCE_START.test(t.charAt(k))) {
        push(a + last, a + end);
        last = end;
      }
    }
    push(a + last, b);
    paragraphs.push({ from: a, to: b, s0, s1: sentences.length });
  }
  return { text: body, paragraphs, sentences };
}

/** The last sentence starting at or before `offset` (0 when none). */
export function sentenceAt(text: LecternText, offset: number): number {
  let found = 0;
  text.sentences.forEach((s, i) => {
    if (s.from <= offset) found = i;
  });
  return found;
}

/**
 * Paragraph `p` of `text` in lines at most `maxW` wide: words (runs of
 * non-space) a space apart, a line broken before the word that would cross
 * the width; a word wider than the line stands on a line of its own. A
 * paragraph that does not exist has no lines.
 */
export function wrapLecternParagraph(
  text: LecternText,
  p: number,
  measure: (s: string) => number,
  maxW: number = LECTERN_PAGE.lineWidthPx,
): LecternToken[][] {
  const para = Number.isInteger(p) ? text.paragraphs[p] : undefined;
  if (para === undefined) return [];
  const space = measure(" ");
  const lines: LecternToken[][] = [];
  let line: LecternToken[] = [];
  let x = 0;
  const slice = text.text.slice(para.from, para.to);
  for (const m of slice.matchAll(/\S+/g)) {
    const word = m[0];
    const w = measure(word);
    if (line.length > 0 && x + space + w > maxW) {
      lines.push(line);
      line = [];
      x = 0;
    }
    const at = line.length > 0 ? x + space : 0;
    const from = para.from + m.index;
    line.push({ from, to: from + word.length, text: word, x: at, w });
    x = at + w;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** The line a sentence starting at `from` begins on (0 when none). */
function lineOf(lines: readonly LecternToken[][], from: number): number {
  const i = lines.findIndex((l) => (l[l.length - 1]?.to ?? 0) > from);
  return Math.max(0, i);
}

/**
 * The first line the page shows for the sentence starting at `from`: two
 * lines above the sentence's line, and never so low that fewer than nine
 * lines of the paragraph would show.
 */
export function lecternWindowStart(
  lines: readonly LecternToken[][],
  from: number,
): number {
  const start = Math.max(0, lineOf(lines, from) - LECTERN_PAGE.leadLines);
  return start + LECTERN_PAGE.rows > lines.length
    ? Math.max(0, lines.length - LECTERN_PAGE.rows)
    : start;
}

/**
 * The sentence a tap turns the page to from sentence `s`: the one seven
 * lines on in the same paragraph, else the next paragraph's first, else
 * the text's first (0). A sentence longer than seven lines moves on to the
 * sentence after it, so a tap never leaves the page where it was (the
 * prototype's turn stuck there).
 */
export function lecternTurn(
  text: LecternText,
  s: number,
  measure: (s: string) => number,
  maxW: number = LECTERN_PAGE.lineWidthPx,
): number {
  const sentence = Number.isInteger(s) ? text.sentences[s] : undefined;
  if (sentence === undefined) return 0;
  const lines = wrapLecternParagraph(text, sentence.p, measure, maxW);
  const next = lines[lineOf(lines, sentence.from) + LECTERN_PAGE.turnLines];
  const para = text.paragraphs[sentence.p];
  if (next?.[0] !== undefined) {
    const at = sentenceAt(text, next[0].from);
    if (at > s) return at;
    if (para !== undefined && s + 1 < para.s1) return s + 1;
  }
  return text.paragraphs[sentence.p + 1]?.s0 ?? 0;
}
