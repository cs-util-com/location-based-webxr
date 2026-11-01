# timing-file.ts

## Purpose

The timing files a speech tool exports, read into timed units before they are lined up with a text (`timing-import.ts`): a subtitle file (WebVTT) or a word list (JSON). Malformed cues and entries are listed, never silently dropped; a file that is no timing throws.

## Public API

- `TimedUnit { label, startMs, endMs, text }` - one cue (`Line N`, the line of its times) or word (`Word N`, the entry counted from 1).
- `TimingFileProblem { label, message }` - a cue or entry that could not be used: "it ends before it starts", "its times cannot be read", "it has no words" / "it has no word", "it is not a timed line", "it is not a word with times".
- `TimingFile { kind: "subtitles" | "words", units, problems }`.
- `TimingFileError` - the file as a whole is unusable; its message completes "Could not use <file>: ...".
- `parseVtt(text)` - the first line must be `WEBVTT` (a BOM and a header text after a space are allowed). Blocks are separated by blank lines; an id line may precede the time line, settings may follow the times; `NOTE`, `STYLE` and `REGION` blocks are skipped. Times `[h:]mm:ss.fff`, a comma for the dot and one to three fraction digits accepted (speech tools export both); minutes and seconds above 59 are unreadable. Cue text: lines joined by a space, tags taken out, entities decoded.
- `parseWordList(text)` - a bare list, `{ words }` or `{ segments: [{ words }] }`; entries `{ word | text, start, end }` in seconds, `start >= 0`, `end >= start`; the word is trimmed (Whisper puts a space before each).
- `readTimingFile(text)` - by content, not by name: `WEBVTT` first is a subtitle file, `[` or `{` a word list, anything else is refused.
- `TIMING_FILE_MAX_CHARS` (5 000 000) and `TIMING_FILE_MAX_UNITS` (50 000) - a file above either is refused.

## Invariants

- Every unit has `0 <= startMs <= endMs` and a non-empty text.
- Every block or entry of the file is either a unit, a problem, or a skipped `NOTE`/`STYLE`/`REGION`.
- Nothing but a `TimingFileError` is thrown, whatever the text (a property test).

## Tests

- `timing-file.test.ts` - cues with ids, settings, tags and entities; each fault listed with its line; refusals; the three word-list shapes; each entry fault; the sniffing; the size cap; a fuzz property over any text.
