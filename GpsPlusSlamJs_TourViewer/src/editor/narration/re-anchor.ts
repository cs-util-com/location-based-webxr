/**
 * A stale read-along track lined up again with its edited text, by the
 * segments' own words (`segments[].text`, which an import writes): every
 * segment whose words are still in the text, in order, keeps its times
 * and moves to where its words stand now; a word edited a little (a typo
 * fixed, an ending changed) keeps its voice too, when it is close enough
 * to the word the voice says (`REANCHOR_MIN_SIMILARITY`). The text is
 * never changed: only the track is made to fit it again.
 *
 * @see re-anchor.ts.md
 */

import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import type {
  TourTiming,
  TourTimingAnchor,
  TourTimingSegment,
} from "gps-plus-slam-app-framework/ar/tour-timing";

import { plainSentences, type TextSpan } from "../../long-text-sentences.js";
import { sentenceStarts } from "../../read-along.js";
import { matchWords, wordTokens, type WordToken } from "./word-diff.js";

/**
 * How alike an edited word must stay to the word the voice says to keep
 * its voice: `wordSimilarity` at least this. Swept over real edits
 * (`re-anchor.test.ts`, "the threshold over real edits"): at 0.8 the
 * voice stays on 14 of 18 typo fixes and spelling variants and on 1 of
 * 18 replaced words ("bride" for "bridge"); 0.7-0.75 keeps 15 typos but
 * 4 replacements ("tall"/"wall"), 0.85 keeps 9 typos. A typo of a short
 * word ("teh") is lost at any value above 0.65: its neighbours keep
 * their voice, and only that word is not lit.
 */
export const REANCHOR_MIN_SIMILARITY = 0.8;

/** A segment of several words keeps its voice when at least this share
 *  of its words is still in the text (a sentence of a subtitle file with
 *  one word edited keeps it; one rewritten does not). */
export const SEGMENT_MIN_SHARE = 0.5;

/** A gap between two words that match exactly gets the word-by-word
 *  comparison up to this many pairs of words. */
const FUZZY_GAP_CELLS = 40_000;

export interface ReAnchorOptions {
  readonly minSimilarity?: number;
  readonly minShare?: number;
}

/** A part of the voice no longer in the text: the voice still says it,
 *  with nothing lit up. */
export interface LostVoice {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

/** A segment kept around an edit: its new place, and what it said. */
export interface ChangedVoice {
  readonly startMs: number;
  readonly from: number;
  readonly to: number;
  readonly was: string;
}

export interface ReAnchored {
  /** Ordered by `startMs`; offsets of the new text. */
  readonly segments: readonly TourTimingSegment[];
  /** Segments whose words are all still there, unchanged. */
  readonly kept: number;
  /** Segments that keep their voice around an edit. */
  readonly adjusted: number;
  /** Those segments, each with the words its voice says (`was`) and
   *  where it stands now. */
  readonly changed: readonly ChangedVoice[];
  /** Segments no longer in the text. */
  readonly lost: readonly LostVoice[];
  /** The marks of a marked track that still have a place. */
  readonly anchors?: readonly TourTimingAnchor[];
}

/** The edit distance of two strings: inserts, deletes, replacements and
 *  swaps of two neighbouring letters (the optimal string alignment
 *  distance), so "teh" is one slip from "the", not two. */
function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const w = y.length + 1;
  const d = new Uint32Array((x.length + 1) * w);
  for (let j = 0; j <= y.length; j += 1) d[j] = j;
  for (let i = 1; i <= x.length; i += 1) {
    d[i * w] = i;
    for (let j = 1; j <= y.length; j += 1) {
      let best = Math.min(
        (d[(i - 1) * w + j] as number) + 1,
        (d[i * w + j - 1] as number) + 1,
        (d[(i - 1) * w + j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        best = Math.min(best, (d[(i - 2) * w + j - 2] as number) + 1);
      }
      d[i * w + j] = best;
    }
  }
  return d[x.length * w + y.length] as number;
}

const DIGIT = /\p{N}/u;

/** How alike two word keys are: 1 less their edit distance over the
 *  longer one's length (1: the same; 0: nothing alike). A word with a
 *  figure in it is alike only to itself: "1890" and "1891" are two
 *  years, not a typo. */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (DIGIT.test(a) || DIGIT.test(b)) return 0;
  const longest = Math.max([...a].length, [...b].length);
  return 1 - editDistance(a, b) / longest;
}

/** A word of the old track: its key, its offset in the old text, and the
 *  segment it is from. */
interface OldWord {
  readonly key: string;
  readonly at: number;
  readonly segment: number;
}

/** In the gap `old[i0..i1)` / `now[j0..j1)`, a longest run of pairs alike
 *  enough (`minSimilarity`), increasing on both sides; written into
 *  `map`, marked fuzzy in `fuzzy`. */
function fuzzyGap(
  old: readonly OldWord[],
  now: readonly WordToken[],
  span: readonly [number, number, number, number],
  minSimilarity: number,
  map: Int32Array,
  fuzzy: Uint8Array,
): void {
  const [i0, i1, j0, j1] = span;
  const n = i1 - i0;
  const m = j1 - j0;
  if (n === 0 || m === 0 || n * m > FUZZY_GAP_CELLS) return;
  const alike = (i: number, j: number) =>
    wordSimilarity(
      (old[i0 + i] as OldWord).key,
      (now[j0 + j] as WordToken).key,
    ) >= minSimilarity;
  const w = m + 1;
  const t = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      t[i * w + j] = alike(i, j)
        ? (t[(i + 1) * w + j + 1] as number) + 1
        : Math.max(t[(i + 1) * w + j] as number, t[i * w + j + 1] as number);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (
      alike(i, j) &&
      t[i * w + j] === (t[(i + 1) * w + j + 1] as number) + 1
    ) {
      map[i0 + i] = j0 + j;
      fuzzy[i0 + i] = 1;
      i += 1;
      j += 1;
    } else if ((t[(i + 1) * w + j] as number) >= (t[i * w + j + 1] as number)) {
      i += 1;
    } else {
      j += 1;
    }
  }
}

/**
 * `timing`'s segments moved onto `text`, the edited text's `P`, by their
 * words. Words are matched exactly first (`matchWords`); between two
 * exact matches, words alike enough (`wordSimilarity`) are paired too. A
 * segment keeps its times when at least `minShare` of its words found a
 * place, spanning from the first of them to the last; one without a
 * `text` (or a word in it) cannot be placed and is lost. A marked track's
 * marks move with the word they stand at, or go. Pure; never throws.
 */
export function reAnchorSegments(
  timing: TourTiming,
  text: string,
  options: ReAnchorOptions = {},
): ReAnchored {
  const minSimilarity = options.minSimilarity ?? REANCHOR_MIN_SIMILARITY;
  const minShare = options.minShare ?? SEGMENT_MIN_SHARE;
  const segments = timing.segments;
  const order = segments
    .map((_, k) => k)
    .sort(
      (a, b) =>
        (segments[a] as TourTimingSegment).from -
          (segments[b] as TourTimingSegment).from ||
        (segments[a] as TourTimingSegment).startMs -
          (segments[b] as TourTimingSegment).startMs,
    );
  const old: OldWord[] = [];
  const firstWord = new Int32Array(segments.length).fill(-1);
  const wordCount = new Int32Array(segments.length);
  for (const k of order) {
    const seg = segments[k] as TourTimingSegment;
    if (typeof seg.text !== "string") continue;
    firstWord[k] = old.length;
    for (const w of wordTokens(seg.text)) {
      old.push({ key: w.key, at: seg.from + w.from, segment: k });
    }
    wordCount[k] = old.length - firstWord[k];
  }
  const now = wordTokens(text);
  const map = new Int32Array(old.length).fill(-1);
  const fuzzy = new Uint8Array(old.length);
  const pairs = matchWords(
    old.map((w) => w.key),
    now.map((w) => w.key),
  );
  let pi = 0;
  let pj = 0;
  for (const [i, j] of [...pairs, [old.length, now.length] as const]) {
    fuzzyGap(old, now, [pi, i, pj, j], minSimilarity, map, fuzzy);
    if (i < old.length) map[i] = j;
    pi = i + 1;
    pj = j + 1;
  }

  const placed: TourTimingSegment[] = [];
  const lost: LostVoice[] = [];
  let kept = 0;
  const changed: ChangedVoice[] = [];
  segments.forEach((seg, k) => {
    const first = firstWord[k] as number;
    const count = wordCount[k] as number;
    let found = 0;
    let exact = 0;
    let from = -1;
    let to = -1;
    for (let i = first; i >= 0 && i < first + count; i += 1) {
      const j = map[i] as number;
      if (j < 0) continue;
      found += 1;
      if (fuzzy[i] === 0) exact += 1;
      const word = now[j] as WordToken;
      if (from < 0) from = word.from;
      to = word.to;
    }
    if (count === 0 || found === 0 || found / count < minShare) {
      lost.push({
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: seg.text ?? "",
      });
      return;
    }
    const piece = text.slice(from, to);
    if (exact === count && piece === seg.text) kept += 1;
    else {
      changed.push({ startMs: seg.startMs, from, to, was: seg.text ?? "" });
    }
    placed.push({
      startMs: seg.startMs,
      endMs: seg.endMs,
      from,
      to,
      text: piece,
    });
  });
  placed.sort((a, b) => a.startMs - b.startMs);
  const anchors =
    timing.anchors === undefined
      ? undefined
      : timing.anchors.flatMap((a) => {
          const i = old.findIndex((w) => w.at >= a.at);
          const j = i < 0 ? -1 : (map[i] as number);
          return j < 0 ? [] : [{ ms: a.ms, at: (now[j] as WordToken).from }];
        });
  return {
    segments: placed,
    kept,
    adjusted: changed.length,
    changed,
    lost,
    ...(anchors === undefined ? {} : { anchors }),
  };
}

/** A track lined up again with an edited body. */
export interface LinedUpAgain extends ReAnchored {
  /** The track for the edited body; null when no segment is left. */
  readonly timing: TourTiming | null;
  /** The body's sentences no segment starts in. */
  readonly unvoiced: readonly TextSpan[];
  readonly sentences: number;
}

/**
 * `timing` lined up again with `body` (`reAnchorSegments`), named by the
 * body's hash (`textHashOf`), so the visitor's read-along follows it
 * again.
 */
export async function lineUpAgain(
  timing: TourTiming,
  body: string,
  lang = "en",
  options: ReAnchorOptions = {},
): Promise<LinedUpAgain> {
  const plain = plainTextOf(parseTourMarkdown(body));
  const moved = reAnchorSegments(timing, plain.text, options);
  const sentences = plainSentences(plain.text, plain.leaves, lang);
  const starts = sentenceStarts(
    { ...timing, segments: moved.segments },
    sentences,
  );
  const next: TourTiming | null =
    moved.segments.length === 0
      ? null
      : {
          granularity: timing.granularity,
          source: timing.source,
          segments: moved.segments,
          ...(moved.anchors === undefined ? {} : { anchors: moved.anchors }),
          textHash: await textHashOf(plain.text),
        };
  return {
    ...moved,
    timing: next,
    unvoiced: sentences.filter((_, s) => starts[s] === -1),
    sentences: sentences.length,
  };
}
