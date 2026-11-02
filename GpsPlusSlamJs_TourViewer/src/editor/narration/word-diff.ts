/**
 * Words compared the way a narration is lined up with its text: a word
 * of the text (the captions' word, `wordsOf`) and its KEY - folded case,
 * accents and apostrophes, so "Café" and "cafe", "don't" and "DON’T" are
 * one word - and a longest common subsequence of two key sequences, the
 * matcher an import (a timing file against the body) and a re-anchoring
 * (a stale track against the edited body) both rest on.
 *
 * @see word-diff.ts.md
 */

import { wordsOf } from "../../caption-chunks.js";

/** A word of a text: its stretch (`from` inclusive, `to` exclusive) and
 *  its key (`wordKey`). */
export interface WordToken {
  readonly from: number;
  readonly to: number;
  readonly key: string;
}

const MARKS = /\p{M}+/gu;
const APOSTROPHES = /['’]/gu;
const SHARP_S = /ß/gu;

/** `word` as it is compared: decomposed (NFKD), without its combining
 *  marks and apostrophes, in lower case, the sharp s as "ss" (German
 *  writes it either way). */
export function wordKey(word: string): string {
  return word
    .normalize("NFKD")
    .replace(MARKS, "")
    .replace(APOSTROPHES, "")
    .toLowerCase()
    .replace(SHARP_S, "ss");
}

/** The words of `text` from `from` to `to`, with their keys. */
export function wordTokens(
  text: string,
  from = 0,
  to = text.length,
): WordToken[] {
  return wordsOf(text, from, to).map((w) => ({
    from: w.from,
    to: w.to,
    key: wordKey(text.slice(w.from, w.to)),
  }));
}

/** A gap is matched by the full table up to this many cells (2 bytes
 *  each), by a bounded greedy walk above it. */
const TABLE_CELLS = 4_000_000;

/** How deep the unique-word anchors recurse before a gap is handed to
 *  the table or the walk as it is. */
const MAX_DEPTH = 48;

/** How far ahead the greedy walk looks for the next word. */
const GREEDY_REACH = 64;

type Pair = [number, number];

/**
 * Index pairs `[i, j]` with `a[i] === b[j]`, increasing in both: a longest
 * common subsequence of `a` and `b`. The shared start and end are paired
 * first; what lies between gets the exact table while it is small
 * (`TABLE_CELLS`). A larger gap is cut at the words that occur once in
 * each of its sides (patience matching, the longest increasing run of
 * them) and each piece is matched again; one with no such word gets a
 * bounded greedy walk. Above the table's size the pairs are therefore
 * equal and increasing but not always the longest, and two long texts
 * that differ in a few words are matched in about linear time.
 */
export function matchWords(a: readonly string[], b: readonly string[]): Pair[] {
  const out: Pair[] = [];
  matchRange(a, b, 0, a.length, 0, b.length, out, 0);
  return out;
}

function matchRange(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  out: Pair[],
  depth: number,
): void {
  let i0 = a0;
  let j0 = b0;
  while (i0 < a1 && j0 < b1 && a[i0] === b[j0]) {
    out.push([i0, j0]);
    i0 += 1;
    j0 += 1;
  }
  let i1 = a1;
  let j1 = b1;
  const tail: Pair[] = [];
  while (i1 > i0 && j1 > j0 && a[i1 - 1] === b[j1 - 1]) {
    i1 -= 1;
    j1 -= 1;
    tail.push([i1, j1]);
  }
  if (i0 < i1 && j0 < j1) {
    if ((i1 - i0) * (j1 - j0) <= TABLE_CELLS) {
      tableMatch(a, b, i0, i1, j0, j1, out);
    } else {
      const anchors =
        depth < MAX_DEPTH ? uniqueAnchors(a, b, i0, i1, j0, j1) : [];
      if (anchors.length === 0) {
        greedyMatch(a, b, i0, i1, j0, j1, out);
      } else {
        let pi = i0;
        let pj = j0;
        for (const [i, j] of anchors) {
          matchRange(a, b, pi, i, pj, j, out, depth + 1);
          out.push([i, j]);
          pi = i + 1;
          pj = j + 1;
        }
        matchRange(a, b, pi, i1, pj, j1, out, depth + 1);
      }
    }
  }
  for (let k = tail.length - 1; k >= 0; k -= 1) out.push(tail[k] as Pair);
}

/** The words that occur exactly once in `a[i0..i1)` and in `b[j0..j1)`,
 *  as pairs, thinned to the longest run increasing on both sides. */
function uniqueAnchors(
  a: readonly string[],
  b: readonly string[],
  i0: number,
  i1: number,
  j0: number,
  j1: number,
): Pair[] {
  const inA = new Map<string, number>();
  for (let i = i0; i < i1; i += 1) {
    const key = a[i] as string;
    inA.set(key, inA.has(key) ? -1 : i);
  }
  const inB = new Map<string, number>();
  for (let j = j0; j < j1; j += 1) {
    const key = b[j] as string;
    inB.set(key, inB.has(key) ? -1 : j);
  }
  const pairs: Pair[] = [];
  for (let i = i0; i < i1; i += 1) {
    const key = a[i] as string;
    const j = inB.get(key);
    if (inA.get(key) === i && j !== undefined && j >= 0) pairs.push([i, j]);
  }
  return longestIncreasing(pairs);
}

/** The longest run of `pairs` (sorted by `i`) whose `j` increases:
 *  patience sorting, O(n log n). */
function longestIncreasing(pairs: readonly Pair[]): Pair[] {
  const tops: number[] = [];
  const back = new Array<number>(pairs.length).fill(-1);
  pairs.forEach(([, j], k) => {
    let lo = 0;
    let hi = tops.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((pairs[tops[mid] as number] as Pair)[1] < j) lo = mid + 1;
      else hi = mid;
    }
    back[k] = lo > 0 ? (tops[lo - 1] as number) : -1;
    tops[lo] = k;
  });
  const out: Pair[] = [];
  for (let k = tops.at(-1) ?? -1; k >= 0; k = back[k] as number) {
    out.push(pairs[k] as Pair);
  }
  return out.reverse();
}

/** The exact LCS of the gap, by the full table. */
function tableMatch(
  a: readonly string[],
  b: readonly string[],
  i0: number,
  i1: number,
  j0: number,
  j1: number,
  out: Pair[],
): void {
  const n = i1 - i0;
  const m = j1 - j0;
  const w = m + 1;
  // The gap's shorter side is at most 2 000 words (`TABLE_CELLS`), so a
  // length fits 16 bits.
  const t = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      t[i * w + j] =
        a[i0 + i] === b[j0 + j]
          ? (t[(i + 1) * w + j + 1] as number) + 1
          : Math.max(t[(i + 1) * w + j] as number, t[i * w + j + 1] as number);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i0 + i] === b[j0 + j]) {
      out.push([i0 + i, j0 + j]);
      i += 1;
      j += 1;
    } else if ((t[(i + 1) * w + j] as number) >= (t[i * w + j + 1] as number)) {
      i += 1;
    } else {
      j += 1;
    }
  }
}

/** Each word of `a`'s gap paired with its next occurrence in `b`'s gap
 *  within `GREEDY_REACH` words. */
function greedyMatch(
  a: readonly string[],
  b: readonly string[],
  i0: number,
  i1: number,
  j0: number,
  j1: number,
  out: Pair[],
): void {
  let j = j0;
  for (let i = i0; i < i1 && j < j1; i += 1) {
    const end = Math.min(j1, j + GREEDY_REACH);
    for (let k = j; k < end; k += 1) {
      if (a[i] === b[k]) {
        out.push([i, k]);
        j = k + 1;
        break;
      }
    }
  }
}
