# narration-visitor.ts

## Purpose

The visitor's narrated texts for the open tour: one voice per text, shared by its reading sheet and its captions strip, and each read-along read when its text opens and judged once (`narration-timing.ts`).

## Public API

- `NarratedTour` - `{ loadEntryText(filename, maxBytes?), manifestWrap }` (the open `TourSession`).
- `createNarrationVisitor({ tour, assets, loadAsset, onError, makePlayer?, warn? })` returns:
  - `verdictOf(block)` - the read-along verdict; undefined for a block that is not a long text; never starts a read.
  - `revision()` - bumped whenever a read-along settles, so a view drawn by a verdict can tell when to look again (`viewer-placement.ts` redraws a text whose captions turned out stale).
  - `sheetNarration(block)` - the sheet's voice (player, timing promise, credit), its read-along read now; undefined for a silent text.
  - `captions(block)` - the strip's content for a text whose read-along fits, or null (while it is read - the read starts here - or when it does not fit).
  - `pauseAll()`, `reset()`.
- `audioAssetPath(assets, id)` - the path of an `audio` asset by id, or null.

## Invariants and defensive measures

- A new tour object drops every player, cached timing and plain text of the old one; a read settling for the old tour does not fill the new cache.
- An audio id the tour has no audio asset for fails the voice through `onError` when played, never at open.
- Sentences are cut with `plainSentences` and the default language, as the sheet cuts them, so the strip and the sheet follow the voice by the same sentences.

## Tests

- `narration-visitor.test.ts` - one player per text, the read on open, live and stale captions, a new tour resetting, a silent text, a block of another kind.
