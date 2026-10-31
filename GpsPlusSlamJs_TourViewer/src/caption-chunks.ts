/**
 * The captions strip's lines: the sentences the voice is in, cut into
 * chunks that fit about three lines (the narrated-text prototype's
 * `chunksFor`): a chunk ends at the last word that keeps it under
 * `maxChars`, moved back to a clause break (`,` `;` `:`) when one lies in
 * its last 45 %, and takes the closing punctuation after its last word
 * with it. Pure; offsets are of the plain text `P`.
 *
 * @see caption-chunks.ts.md
 */

/** A word of `P`: letters and digits, with inner apostrophes (the
 *  prototype's word); punctuation lies between words. */
export interface CaptionWord {
  readonly from: number;
  readonly to: number;
}

/** A chunk: its stretch of `P` and its words `w0` to `w1` (exclusive),
 *  indices into the words it was cut from; -1, -1 for a chunk of none. */
export interface CaptionChunk {
  readonly from: number;
  readonly to: number;
  readonly w0: number;
  readonly w1: number;
}

/** Characters a chunk may hold, by layout (the prototype's). */
export const CAPTION_MAX_CHARS = {
  portrait: 96,
  landscape: 118,
  desktop: 120,
} as const;

export type CaptionLayout = keyof typeof CAPTION_MAX_CHARS;

/** A clause break moves a cut back only within this share of a chunk. */
const CLAUSE_LOOKBACK = 0.55;

const CLOSERS = /[,;:.!?'"’”)]/u;
const CLAUSE = /[,;:]/u;

/** The words of `text` from `from` to `to`. */
export function wordsOf(text: string, from: number, to: number): CaptionWord[] {
  const out: CaptionWord[] = [];
  const re = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  re.lastIndex = Math.max(0, from);
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index >= to) break;
    out.push({ from: m.index, to: Math.min(to, m.index + m[0].length) });
  }
  return out;
}

/**
 * Where a chunk that must end before word `k` ends: at the last clause
 * break (`CLAUSE`) of its words when one falls late enough in it
 * (`CLAUSE_LOOKBACK`), else on the word before `k`.
 */
function cutBefore(
  text: string,
  words: readonly CaptionWord[],
  span: { readonly start: number; readonly startW: number },
  k: number,
  max: number,
): number {
  for (let b = k - 1; b > span.startW + 2; b -= 1) {
    const here = words[b];
    const after = words[b + 1];
    if (here === undefined || after === undefined) break;
    if (here.to - span.start < max * CLAUSE_LOOKBACK) break;
    if (CLAUSE.test(text.slice(here.to, after.from))) return b;
  }
  return k - 1;
}

/**
 * The chunks of `text` from `from` to `to`, in order; at least one.
 * `maxChars` below 1 is read as 1.
 */
export function captionChunks(
  text: string,
  from: number,
  to: number,
  maxChars: number,
): { readonly words: CaptionWord[]; readonly chunks: CaptionChunk[] } {
  const max = Math.max(1, Number.isFinite(maxChars) ? maxChars : 1);
  const words = wordsOf(text, from, to);
  const chunks: CaptionChunk[] = [];
  let start = from;
  let startW = 0;
  for (let k = 0; k < words.length; k += 1) {
    const w = words[k];
    if (w === undefined || !(w.to - start > max && k > startW)) continue;
    const cut = cutBefore(text, words, { start, startW }, k, max);
    let end = words[cut]?.to ?? start;
    while (end < to && CLOSERS.test(text.charAt(end))) end += 1;
    chunks.push({ from: start, to: end, w0: startW, w1: cut + 1 });
    startW = cut + 1;
    start = words[startW]?.from ?? end;
    k = cut;
  }
  if (startW < words.length) {
    chunks.push({ from: start, to, w0: startW, w1: words.length });
  }
  if (chunks.length === 0) chunks.push({ from, to, w0: -1, w1: -1 });
  return { words, chunks };
}

/** The word holding offset `at` (or the last before it), or -1. */
export function wordHolding(words: readonly CaptionWord[], at: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((words[mid]?.from ?? Infinity) <= at) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The chunk holding word `w`; the first for none. */
export function chunkHolding(
  chunks: readonly CaptionChunk[],
  w: number,
): number {
  const i = chunks.findIndex((c) => w >= c.w0 && w < c.w1);
  return i < 0 ? 0 : i;
}
