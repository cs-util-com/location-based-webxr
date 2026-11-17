# narration-visitor.ts

## Purpose

The visitor's narrated texts for the open tour: one voice per text, shared by its reading sheet and the narration box (`narration-box.ts`), and each read-along read when its text opens and judged once (`narration-timing.ts`).

## Public API

- `NarratedTour` - `{ loadEntryText(filename, maxBytes?), manifestWrap }` (the open `TourSession`).
- `createNarrationVisitor({ tour, assets, loadAsset, onError, makePlayer?, warn? })` returns:
  - `verdictOf(block)` - the read-along verdict; undefined for a block that is not a long text; never starts a read.
  - `revision()` - bumped whenever a read-along settles, so a view drawn by a verdict can tell when to look again (`viewer-placement.ts` redraws a text whose captions turned out stale).
  - `sheetNarration(block)` - the sheet's voice (player, timing promise, credit), its read-along read now; undefined for a silent text.
  - `captions(block)` - the narration box's content (key, title, the speaker, the plain text, the timing, the voice, whether it is synthetic) for a text whose read-along fits, or null (while it is read - the read starts here - or when it does not fit). The speaker of a long text is "Narrator" in `#f9a8d4`, a colour no character uses.
  - `pauseAll(stationId?)` - pauses every voice; with an id, those wanted now (playing, or held by the voice channel) are kept for `carryOn`.
  - `carryOn(stationId)` - the visitor is back: what that station's leaving paused carries on, as far as the voice channel lets it. The one heard last takes the channel, the next waits behind it and carries on when that one ends or is tapped, any further one stays at its place and a tap takes it up.
  - `reset()`.
- `audioAssetPath(assets, id)` - the path of an `audio` asset by id, or null.

## Invariants and defensive measures

- A new tour object drops every player, cached timing and plain text of the old one; a read settling for the old tour does not fill the new cache.
- An audio id the tour has no audio asset for fails the voice through `onError` when played, never at open.
- The box lights words by the timing's offsets into the plain text (`plainTextOf`), the same text the timing was checked against.

## The voice channel

Every text's voice is a `focusedPlayer` in the page's one channel (`voice-focus.ts`, the `focus` dep, a channel of its own when none is given): the sheet and the box get the wrapped player, so playing one holds whatever else speaks. `pauseAll` pauses the held voices before the one heard, because pausing the one heard would wake them.

## Tests

- `narration-visitor.test.ts` - one player per text, the read on open, live and stale captions, a new tour resetting, `reset()` letting a real player's audio source and blob URL go, a silent text, a block of another kind.
