# captions-follow.ts

## Purpose

Decides when the captions strip shows, and what: inside a station, the first of its free long texts a visitor sees in the captions view, while its read-along fits. Leaving the station pauses the voice. Called on every camera frame.

## Public API

- `captionsBlock(blocks, stored, verdictOf)` - the first long text whose shown view (`shownView`, with its verdict) is `captions`, or null.
- `createCaptionsFollow({ strip, narration, read })` returns:
  - `sync()` - shows, moves or hides the strip; cheap enough for every frame.
  - `stop()` - the AR session ended: the strip goes, the voice pauses.

## Invariants

- No strip outside a station, for a text shown in another view, or while its timing is unread, pending or stale (`narration.captions` gives null then; the first call starts the read).
- A stale timing makes `shownView` fall back from captions, so the world shows the text in another view and the strip never shows empty.
- A voice does not follow the visitor out of its station.

## Tests

- `captions-follow.test.ts` - the first captions text, the strip once the read-along fits, pausing on leaving and on stop.
