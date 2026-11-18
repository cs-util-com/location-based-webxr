/**
 * The narration box's arithmetic (`narration-box.ts`): when each word of
 * a narrated text starts in its voice, which word is lit at a time, how
 * the words fall into lines, and the one mapping between a voice time and
 * a scroll position in lines that makes scrolling the words the same as
 * scrubbing the voice. Pure; every lookup a binary search or a short
 * walk, so the box may ask on every frame.
 *
 * @see narration-box-timeline.ts.md
 */

import type { TourTiming } from "gps-plus-slam-app-framework/ar/tour-timing";

import type { PlainWord } from "./plain-words.js";
import { lastAtOrBefore } from "./last-at-or-before.js";

/** Lines of words the box shows at most. */
export const BOX_MAX_ROWS = 3;
/** The row the spoken line sits in (0 the top): the middle one, so one
 *  line of what was just said stays in view above it. */
export const BOX_FOLLOW_ROW = 1;
/** How far a finger may move (px) and still be a tap (the prototype's
 *  value, not tuned further). */
export const BOX_TAP_SLOP_PX = 8;
/** How far the words stretch past the first or last line, per line
 *  dragged (the rubber band). */
const OVERSCROLL_SHARE = 0.3;
/** The scrollbar thumb's smallest height (px). */
const THUMB_MIN_PX = 14;

/**
 * When each word starts in the voice (ms), in word order. A word inside
 * a segment starts at that segment's start plus its share of the
 * segment's letters (on a word track that share is 0); a word between
 * segments starts where the last one before it ends; a word before every
 * segment at 0. Never decreasing, always finite.
 */
export function wordStartsMs(
  words: readonly PlainWord[],
  timing: Pick<TourTiming, "segments">,
): number[] {
  const byPlace = [...timing.segments]
    .filter(
      (s) =>
        Number.isFinite(s.startMs) &&
        Number.isFinite(s.endMs) &&
        Number.isFinite(s.from) &&
        Number.isFinite(s.to),
    )
    .sort((a, b) => a.from - b.from || a.startMs - b.startMs);
  let last = 0;
  return words.map((word) => {
    const k = lastAtOrBefore(byPlace, (s) => s.from, word.from);
    const seg = byPlace[k];
    let at = 0;
    if (seg !== undefined) {
      if (word.from < seg.to && seg.to > seg.from) {
        const share = (word.from - seg.from) / (seg.to - seg.from);
        at = seg.startMs + share * Math.max(0, seg.endMs - seg.startMs);
      } else {
        at = seg.endMs;
      }
    }
    last = Math.max(last, at);
    return last;
  });
}

/** The last word started at or before `ms`, or -1. */
export function wordAt(starts: readonly number[], ms: number): number {
  return lastAtOrBefore(starts, (s) => s, ms);
}

/**
 * Line numbers for words by their top (px) in the laid-out text. With
 * `firstTop` (the speaker's name, which opens line 0), a word's line is
 * how many line heights it sits below the name, so a line that holds no
 * word (a long voice credit after the name) still counts. Without it, a
 * top within half a line height of a line already seen is on that line.
 */
export function lineIndices(
  tops: readonly number[],
  lineHeightPx: number,
  firstTop?: number,
): number[] {
  const lh = Math.max(1, lineHeightPx);
  if (firstTop !== undefined && Number.isFinite(firstTop)) {
    return tops.map((top) => Math.max(0, Math.round((top - firstTop) / lh)));
  }
  const seen: number[] = [];
  const half = lh / 2;
  return tops.map((top) => {
    let k = seen.findIndex((t) => Math.abs(t - top) < half);
    if (k < 0) {
      seen.push(top);
      k = seen.length - 1;
    }
    return k;
  });
}

/**
 * Where each line starts in the voice (its first word's start), plus one
 * closing entry, the voice's total. At least one line.
 */
export function lineStarts(
  starts: readonly number[],
  lineOf: readonly number[],
  totalMs: number,
): number[] {
  const lines = Math.max(1, ...lineOf.map((l) => l + 1));
  const out: number[] = [];
  starts.forEach((s, i) => {
    const l = lineOf[i];
    if (l !== undefined && out[l] === undefined) out[l] = s;
  });
  let prev = 0;
  for (let l = 0; l < lines; l += 1) {
    prev = Math.max(prev, out[l] ?? prev);
    out[l] = prev;
  }
  out[lines] = Math.max(prev, Number.isFinite(totalMs) ? totalMs : prev);
  return out;
}

/** The voice at `ms` as a line position: line k plus how far through it,
 *  the line count at or past the end. */
export function lineFloatAt(ls: readonly number[], ms: number): number {
  const lines = ls.length - 1;
  const total = ls[lines] ?? 0;
  if (lines < 1 || !Number.isFinite(ms) || ms <= (ls[0] ?? 0)) return 0;
  if (ms >= total) return lines;
  const k = Math.max(
    0,
    Math.min(
      lines - 1,
      lastAtOrBefore(ls, (x) => x, ms),
    ),
  );
  const a = ls[k] ?? 0;
  const span = (ls[k + 1] ?? a) - a;
  return k + (span > 0 ? Math.min(1, Math.max(0, (ms - a) / span)) : 0);
}

/** The voice time at line position `x` (clamped to the text). */
export function timeAtLine(ls: readonly number[], x: number): number {
  const lines = ls.length - 1;
  const v = Math.min(lines, Math.max(0, Number.isFinite(x) ? x : 0));
  const k = Math.floor(v);
  if (k >= lines) return ls[lines] ?? 0;
  const a = ls[k] ?? 0;
  return a + (v - k) * ((ls[k + 1] ?? a) - a);
}

/** The scroll (in lines) that puts `line` in the follow row. */
export function followScroll(
  line: number,
  lines: number,
  rows: number,
): number {
  const top = Math.max(0, lines - rows);
  return Math.min(top, Math.max(0, line - BOX_FOLLOW_ROW));
}

/** A dragged scroll past either end, moved 0.3 as far. */
export function rubberBand(raw: number, top: number): number {
  if (raw < 0) return raw * OVERSCROLL_SHARE;
  if (raw > top) return top + (raw - top) * OVERSCROLL_SHARE;
  return raw;
}

/** The scrollbar thumb on a track `trackPx` high: its height by the share
 *  of the lines shown, its offset by the scroll. */
export function thumbGeometry(
  scroll: number,
  lines: number,
  rows: number,
  trackPx: number,
): { height: number; offset: number } {
  const height = Math.max(THUMB_MIN_PX, (trackPx * rows) / Math.max(1, lines));
  const top = Math.max(1, lines - rows);
  const share = Math.min(1, Math.max(0, scroll / top));
  return { height, offset: share * Math.max(0, trackPx - height) };
}

/** Whether a press that moved `dx`, `dy` (px) is a tap. */
export function isTap(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) <= BOX_TAP_SLOP_PX;
}
