/**
 * Where the voice is in a narrated long text's words: from a read-along
 * timing (the framework's `ar/tour-timing`) and the voice's time, the
 * segment spoken now, the sentences it lies in, and whether a single word
 * may be marked - plus where each sentence starts in the voice, for a tap
 * on a sentence and for "previous sentence". Pure; every lookup is a
 * binary search, so the sheet and the captions strip may ask on every
 * frame.
 *
 * @see read-along.ts.md
 */

import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import { lastAtOrBefore } from "./last-at-or-before.js";
import { sentenceHolding } from "./long-text-sentences.js";

/** A stretch of `P`, `from` inclusive, `to` exclusive. */
interface PlainSpan {
  readonly from: number;
  readonly to: number;
}

/** The voice now: the segment spoken (or the last one started, between
 *  two), and the first and last sentence it lies in. */
export interface ReadAlongCursor {
  readonly segment: number;
  readonly from: number;
  readonly to: number;
  readonly s0: number;
  readonly s1: number;
}

/** How long into a sentence "previous sentence" goes back to its own
 *  start rather than to the one before (the prototype's rule). */
const PREV_SENTENCE_RESTART_MS = 1600;

/** How far before a sentence's first segment a seek lands, so its first
 *  sound is not cut (the prototype's 30 ms). */
const SEEK_LEAD_MS = 30;

/** A word is marked only on a word track read from a file; a marked
 *  track (a creator tapping along) is only good to the sentence. */
export function marksWords(timing: TourTiming): boolean {
  return timing.granularity === "word" && timing.source === "file";
}

/** The last segment starting at or before `ms`, or -1 (before the first,
 *  or none). */
export function segmentAt(
  segments: readonly { readonly startMs: number }[],
  ms: number,
): number {
  if (!Number.isFinite(ms)) return -1;
  return lastAtOrBefore(segments, (s) => s.startMs, ms);
}

/** The voice at `ms` over `sentences` (in `P` order), or null before its
 *  first segment. */
export function cursorAt(
  timing: TourTiming,
  sentences: readonly PlainSpan[],
  ms: number,
): ReadAlongCursor | null {
  const segment = segmentAt(timing.segments, ms);
  const seg = timing.segments[segment];
  if (seg === undefined) return null;
  const index = { sentences };
  const s0 = sentenceHolding(index, seg.from);
  const s1 = Math.max(s0, sentenceHolding(index, seg.to - 1));
  return { segment, from: seg.from, to: seg.to, s0, s1 };
}

/** Per sentence, the first segment (in time) that starts inside it, or -1
 *  for a sentence the voice never reaches. */
export function sentenceStarts(
  timing: TourTiming,
  sentences: readonly PlainSpan[],
): number[] {
  const starts = sentences.map(() => -1);
  const index = { sentences };
  timing.segments.forEach((seg, k) => {
    const s = sentenceHolding(index, seg.from);
    const sentence = sentences[s];
    if (sentence === undefined || starts[s] !== -1) return;
    if (seg.from < sentence.to) starts[s] = k;
  });
  return starts;
}

/** Where a seek to sentence `s` lands, or null when the voice never
 *  reaches it. */
export function sentenceSeekMs(
  timing: TourTiming,
  starts: readonly number[],
  s: number,
): number | null {
  const k = starts[s];
  const seg = k === undefined || k < 0 ? undefined : timing.segments[k];
  return seg === undefined ? null : Math.max(0, seg.startMs - SEEK_LEAD_MS);
}

/**
 * "Previous sentence" at `ms`: back to the start of the sentence spoken
 * now when more than `PREV_SENTENCE_RESTART_MS` into it, else to the
 * start of the nearest earlier sentence the voice reaches; null when
 * there is none (then the button goes to 0).
 */
export function previousSentenceMs(
  timing: TourTiming,
  sentences: readonly PlainSpan[],
  starts: readonly number[],
  ms: number,
): number | null {
  const now = cursorAt(timing, sentences, ms);
  if (now === null) return null;
  const own = sentenceSeekMs(timing, starts, now.s0);
  if (own !== null && ms - (own + SEEK_LEAD_MS) > PREV_SENTENCE_RESTART_MS) {
    return own;
  }
  for (let s = now.s0 - 1; s >= 0; s -= 1) {
    const at = sentenceSeekMs(timing, starts, s);
    if (at !== null) return at;
  }
  return null;
}

/** `m:ss` of `ms`, rounded to the second (the prototype's clock). */
export function clockText(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

/** Minutes of narration, at least 1 (the prototype's rule). */
export function narrationMinutes(ms: number): number {
  return Number.isFinite(ms) && ms > 0
    ? Math.max(1, Math.round(ms / 60_000))
    : 1;
}
