# timing-import.ts

## Purpose

A timing file lined up with a long text's body: the read-along track a narration's `timing/<blockId>.json` carries (`ar/tour-timing` of the framework), and what of the file and the text did not meet, for the creator to see. The text is never changed.

## Public API

- `lineUpFile(plain, file, lang?)` - pure: `{ granularity, segments, units, matchedUnits, mismatches, unvoiced, sentences }` for a `TimingFile` against a `TourPlainText`.
  - A subtitle file gives a `sentence` track: each matching line covers the stretch from its first to its last matched word, with the line's times. A line with under half of its words in the text (`SUBTITLE_LINE_MIN_SHARE`, the prototype's rule) is a mismatch, and the rest are matched again without it.
  - A word list gives a `word` track: one segment per matched word, the unit's time split among its words by length. Each run of unmatched entries is one mismatch (`Word N` or `Words N-M`).
  - `unvoiced` - the text's sentences (`plainSentences`) no segment starts in (`sentenceStarts` of `read-along.ts`).
- `importTiming(body, fileText, lang?)` - reads the file, lines it up and names the track by `textHashOf(P)`; `timing` is null when nothing matched; `problems` are the file's own faults. Rejects with `TimingFileError` for a file that is no timing, or a track over the entry's caps.
- `timingFitsEntry(timing)` - within `TOUR_TIMING_MAX_SEGMENTS` and `TOUR_TIMING_MAX_BYTES` as compact JSON.
- `ImportMismatch { label, startMs, endMs, text }`, `LinedUpFile`, `TimingImport`.

## Invariants

- Segments are ordered by `startMs`, offsets are of `P`, `from < to`, and `text` is `P.slice(from, to)`: what the re-anchoring of an edited text reads (`re-anchor.ts`).
- Words are matched by key (`word-diff.ts`). A match with no matched neighbour is a chance hit and dropped, unless the text has one word.
- The track's `source` is `file`: a word track from a word list may mark single words for a visitor (`marksWords`); a subtitle file's estimated word times never do, since its track is a sentence track.

## Tests

- `timing-import.test.ts` - a sentence track, a line not in the text, unvoiced sentences, a word track, a run of extra words, a chance single word, time order, the entry the visitor's reader accepts as fitting, no timing, the file's own faults passed on and a refusal.
