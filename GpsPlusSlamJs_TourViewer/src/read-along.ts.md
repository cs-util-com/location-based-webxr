# read-along.ts

## Purpose

Where the voice is in a narrated text's words: from a read-along timing and the voice's time, the segment spoken now, the sentences it lies in, and whether a single word may be marked; plus where each sentence starts in the voice, for a tap on a sentence and for "previous sentence". Pure.

## Public API

- `ReadAlongCursor` - `{ segment, from, to, s0, s1 }`: the segment spoken (or the last started, between two), its stretch of `P`, and the first and last sentence it lies in.
- `marksWords(timing)` - only a `word` track read from a `file` marks single words; a `sentence` track, or a creator's `marked` track, marks sentences only (a word estimated between marks is wrong too often).
- `segmentAt(timing, ms)`, `cursorAt(timing, sentences, ms)` - binary searches; null before the first segment.
- `sentenceStarts(timing, sentences)` - per sentence, the first segment in it, or -1.
- `sentenceSeekMs(timing, starts, i)` - where a tap on sentence `i` plays from (`SEEK_LEAD_MS` early), or null.
- `previousSentenceMs(timing, sentences, starts, nowMs)` - the start of this sentence, or of the one before when less than `PREV_SENTENCE_RESTART_MS` has been spoken.
- `clockText(ms)` - `m:ss`; `narrationMinutes(ms)` - whole minutes, at least 1.

## Invariants

- Segments are ordered by `startMs` (the framework's parser refuses otherwise).
- Every lookup is a binary search, so the sheet and the strip may ask on every frame.
- Non-finite times give null or 0, never a throw.

## Tests

- `read-along.test.ts` - cursors between and inside segments, word against sentence tracks, the sentence starts, the previous-sentence rule, the clock text.
