# narration-box-timeline.ts

## Purpose

The narration box's arithmetic: when each word of a narrated text starts
in its voice, which word is lit at a time, how laid-out words fall into
lines, and the one mapping between voice time and scroll position (in
lines) that makes dragging the words the same as scrubbing the voice.
Pure, so the box (`narration-box.ts`) may ask on every frame.

## Public API

- `BOX_MAX_ROWS` (3), `BOX_FOLLOW_ROW` (1, the middle row),
  `BOX_TAP_SLOP_PX` (8).
- `wordStartsMs(words, timing)` - each word's start (ms). Inside a
  segment: its start plus the word's share of the segment's letters (0 on
  a word track, so a word track gives each word its own start; a sentence
  or hand-marked track spreads its time over its words). Between segments:
  the end of the last one before; before every segment: 0. Never
  decreasing, always finite; segments with a non-finite field are skipped.
- `wordAt(starts, ms)` - the last word started at or before `ms`, -1 for
  none or NaN.
- `lineIndices(tops, lineHeightPx, firstTop?)` - a line number per word
  from its laid-out top. With `firstTop` (the speaker's name, line 0) it
  is the line heights below the name, rounded, so a line that holds no
  word (a long voice credit) still counts; without, a top within half a
  line height of a seen line joins it. The first way assumes the real
  line pitch is `lineHeightPx` (a fixed px line height); a relative line
  height would need the clustering back.
- `lineStarts(starts, lineOf, totalMs)` - each line's start (its first
  word's), never decreasing, plus a closing entry, the voice's total. No
  words: one line `[0, total]`.
- `lineFloatAt(lineStarts, ms)` / `timeAtLine(lineStarts, x)` - time to
  line position (line k plus the share through it) and back, both clamped
  to the text.
- `followScroll(line, lines, rows)` - the scroll that puts `line` in the
  follow row, clamped to `[0, lines - rows]`.
- `rubberBand(raw, top)` - a dragged scroll past either end moves 0.3 as
  far.
- `thumbGeometry(scroll, lines, rows, trackPx)` - the scrollbar thumb's
  height (the share of lines shown, at least 14 px) and offset.
- `isTap(dx, dy)` - moved at most 8 px.

## Invariants & assumptions

- Every value is the prototype's (calm HUD round 5, scroll box): three
  rows, the spoken line in the middle one, 0.3 rubber band, 14 px thumb
  minimum, 8 px tap slop.
  - None of them was tuned beyond the prototype: they are a feel, to be
    judged on a phone, and a sweep without a hand on a phone would say
    nothing. The tap slop is the one with a failure on either side (too
    small: a tap on a moving phone becomes a scrub; too large: a short
    drag becomes a pause); the field test is where it is judged.
- `timeAtLine(lineFloatAt(t))` returns `t` wherever lines have length
  (property test), so a drag lands where the finger left the words.
- Word offsets are UTF-16 indices into the plain text (`wordsOf` in
  `plain-words.ts`), the same the timing track uses.

## Examples

```ts
const words = wordsOf(plain, 0, plain.length);
const starts = wordStartsMs(words, timing);
const lit = wordAt(starts, player.nowMs());
const ls = lineStarts(starts, lineIndices(tops, 22), player.durationMs());
player.seek(timeAtLine(ls, lineFloatAt(ls, player.nowMs()) + dy / 22));
```

## Tests

- `narration-box-timeline.test.ts`: word and sentence tracks, words the
  track never reaches, never running backwards (property), `wordAt`, line
  grouping, line starts, the time-line round trip and monotonicity
  (properties), follow scroll, rubber band, thumb, tap.
