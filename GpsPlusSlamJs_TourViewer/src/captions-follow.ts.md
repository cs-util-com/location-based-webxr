# captions-follow.ts

## Purpose

Decides when the narration box (`narration-box.ts`) shows, and what: inside a station, the first of its free long texts a visitor sees in the captions view, while its read-along fits. Leaving the station pauses the voice. Called on every camera frame.

## Public API

- `captionsBlock(blocks, stored, verdictOf)` - the first long text whose shown view (`shownView`, with its verdict) is `captions`, or null.
- `createCaptionsFollow({ box, narration, read })` returns:
  - `sync()` - shows, moves or hides the box; cheap enough for every frame.
  - `stop()` - the AR session ended: the box goes, the voice pauses.

## Invariants

- No box outside a station (with no present station it hides even if it is handed blocks; the station's exit distance, with its hysteresis, is the voice's radius), for a text shown in another view, or while its timing is unread, pending or stale (`narration.captions` gives null then; the first call starts the read).
- A stale timing makes `shownView` fall back from captions, so the world shows the text in another view and the box never shows empty.
- A voice does not follow the visitor out of its station.

## Leaving and coming back

Leaving a station pauses its voices by name (`pauseAll(stationId)`), and arriving at one calls `carryOn(stationId)`, so a voice picks up where the visitor left it. `stop` pauses without a name: nothing carries on after the session.

## Tests

- `captions-follow.test.ts` - the first captions text, the box once the read-along fits, no box and no voice outside a station even when handed its blocks, pausing on leaving and on stop.
