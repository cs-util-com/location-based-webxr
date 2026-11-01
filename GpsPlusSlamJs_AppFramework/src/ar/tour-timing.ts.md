# tour-timing.ts

**Purpose:** a narrated long text's read-along TIMING (`tour.json`
version 4 minor 5): which stretch of the text the voice speaks when. It is
its own archive entry, `timing/<blockId>.json`, beside `tour.json`, named
by the long text's `narration.timing` (`tour-blocks.ts`). A tour opens
without reading any timing; a viewer reads one only when its text opens.
The archive's signed file list covers it like every other entry.

## Public API

- `TOUR_TIMING_FOLDER` (`'timing'`), `TOUR_TIMING_MAX_BYTES` (1 500 000),
  `TOUR_TIMING_MAX_SEGMENTS` (20 000), `TOUR_TIMING_MAX_ANCHORS` (2 000).
- `tourTimingEntryName(blockId): string` - `timing/<blockId>.json`;
  throws `TypeError` for an id that is not a tour id (`TOUR_ID_PATTERN`),
  as `tourContentEntryName` does: the name reaches a zip path.
- Types: `TourTiming { granularity: 'word' | 'sentence', source: 'file' |
'marked', segments, anchors?, textHash }`, `TourTimingSegment { startMs,
endMs, from, to, text? }`, `TourTimingAnchor { ms, at }`,
  `TourTimingText { plainLength, textHash, durationMs? }`.
- `parseTourTiming(value): TourTiming` - the STRUCTURE; throws
  `TourTimingError` on a structural fault. Unknown fields are ignored.
- `parseTourTimingText(text): TourTiming` - the entry's text: over
  `TOUR_TIMING_MAX_BYTES` UTF-16 units, not JSON, or a structural fault
  throws `TourTimingError`.
- `tourTimingStaleReason(timing, text): string | null` - the RANGE: why
  the track no longer fits its text, or null. Never throws.
- `class TourTimingError extends Error`.

## Invariants & assumptions

- Offsets are UTF-16 units of the body's plain text `P`
  (`tour-markdown.ts` `plainTextOf`), never of the Markdown source;
  `from` inclusive, `to` exclusive. `textHash` is `textHashOf(P)`
  (`"sha256:"` and 64 lowercase hex): a formatting change never breaks a
  track, a change of the words always shows.
- **Two kinds of fault, kept apart:**
  - STRUCTURAL (fails, a creator tool's bug): not an object; a missing or
    non-integer (`Number.isSafeInteger`) field; a negative number;
    `from >= to`; `startMs > endMs`; segments not ordered by `startMs`
    (equal starts are allowed); more than 20 000 segments; an unknown
    `granularity` or `source`; `anchors` on a track whose source is not
    `marked`, not an array, or more than 2 000; a `text` that is not a
    string; a `textHash` that is not a string.
  - RANGE (STALE, a viewer shows plain text and tells the visitor
    nothing): no segments; a `textHash` of an unknown kind or different
    from the text's; an offset beyond `P`; an `endMs` beyond the
    narration's `durationMs` when the tour gives one.
- `segments[].text` is kept: viewers ignore it, an editor re-anchors an
  edited text by it.
- A view shows a word highlight only for `granularity: 'word'` and
  `source: 'file'`; a marked track shows sentences only (the viewer's
  rule, stated here because it is why `source` exists).
- Pure; the caller hashes (`textHashOf` needs WebCrypto and is async).

## The cap, swept

`TOUR_TIMING_MAX_BYTES` is sized from the segment cap. Measured (a scratch
sweep over word lengths 2-14 and start times from 5 s to 1 h, offsets near
the 32 000 end): a compact word segment with its `text` takes 70-84 bytes
(design estimate 75), a pretty-printed one (two-space indent) 120-134. So
the cap holds 18 000-21 500 compact segments and 11 200-12 500
pretty-printed ones. A 32 000-unit body holds about 5 600 words at 5.7
units a word and about 7 100 at 4.5, so a word track of the longest body
fits either way, with room. A file at the full 20 000-segment cap fits the
byte cap only with short words; that file would also need a body of 20 000
words, which the body cap does not allow.

The writer's side of the contract: a timing entry is written as compact
JSON (`JSON.stringify` with no indent). The cap is not raised for
pretty-printed files; a writer that indents gives up about 40 % of the
segment room.

## Examples

```ts
import {
  parseTourTimingText,
  tourTimingEntryName,
  tourTimingStaleReason,
} from 'gps-plus-slam-app-framework/ar/tour-timing';
import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from 'gps-plus-slam-app-framework/ar/tour-markdown';

const raw = await readEntry(tourTimingEntryName(block.id)); // capped read
const timing = parseTourTimingText(raw); // throws TourTimingError
const P = plainTextOf(parseTourMarkdown(block.body)).text;
const stale = tourTimingStaleReason(timing, {
  plainLength: P.length,
  textHash: await textHashOf(P),
  durationMs: block.narration?.durationMs,
});
// stale === null: read along; otherwise show the plain text
```

## Tests

- `tour-timing.test.ts` - the entry name and unsafe ids; a well-formed
  track read back; unknown fields ignored; one test per structural rule;
  equal starts and zero-length times allowed; the segment and anchor caps
  at N and N+1; a malformed hash reading as stale; the text cap at N and
  N+1 and non-JSON; each range fault at its edge.
- `tour-timing.property.test.ts` - any well-formed segment list reads back
  unchanged; any list with one structural rule broken is refused with
  `TourTimingError`; starts stepping back are refused; the range check is
  null exactly when every offset and time fits.
