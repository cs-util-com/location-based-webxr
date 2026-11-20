# captions-follow.ts

## Purpose

Decides when a narrated text's words show, where, and what: inside a station, the first of its free long texts whose read-along fits, at the bottom (the narration box, `narration-box.ts`) or travelling from its reading sign (`travelling-box.ts`). Leaving the station pauses the voice. Each fitting narrated sign gets its voice chip. Called on every camera frame.

## Public API

- `narratedShown(blocks, stored, verdictOf)` - the first long text whose read-along fits (a timing declared and not found stale: the captions view's needs, `viewNeedsFail`) and whose words show, as `{ block, mode: "box" | "travel" }`, or null:
  - shown view `captions` (the visitor picked Captions): `box`;
  - shown view `reading`: `travel` when the visitor picked Reading (`preferredView`), or when the creator chose the sign (`narration.words === "sign"`) and the visitor picked nothing or a view the text cannot meet (a Lectern pick for a text with pictures shows the creator's Reading, so the creator's choice of where the words show holds too); else `box`;
  - shown view `lectern`: passed over, the reading stand shows the words itself;
  - "Use the creator's choice again" clears the pick, so the creator's mode is back.
- `chipOf(voice, playing)` - a sign's voice chip: `playing` as the page's store says, else `ended` at the voice's known end, `paused` past its start, else `idle`.
- `createCaptionsFollow({ box, narration, read, travel, signOf, sheetOpen, playing })` returns:
  - `sync()` - shows, moves or hides the words; cheap enough for every frame.
  - `stop()` - the AR session ended: the travel stops, the box goes, the voice pauses.
- Its deps beyond the box, the narration and `read`:
  - `travel(start: TravelStart)` - starts the travel of a text's words from its sign (`{ id, sign, travelling, voice, inStation, sheetOpen }`, what `signWordsSurface` needs besides the box and the scale) and returns `{ stop }`, or null where the page cannot (no scene or camera yet);
  - `signOf(blockId)` - the mounted reading sign (`mountedReadingSign`), or null;
  - `sheetOpen()` - the reading sheet is open;
  - `playing(key)` - the `narrationBox` slice says the text `key`'s voice plays.

## Invariants

- No words outside a station (with no present station they hide even if it is handed blocks; the station's exit distance, with its hysteresis, is the voice's radius), for a text shown at a lectern, or while its timing is unread, pending or stale (`narration.captions` gives null then; the first call starts the read).
- One travel at a time, for one text and one sign: made once, stopped and made again when the text or its sign changes, stopped when the words go back to the box, when the words go, and on `stop`. Without the sign mounted, or where `travel` gives null, the words show in the box meanwhile (`show(content, "natural")`); while travelling the box is the ghost (`show(content, "travel")`).
- The reading sheet open hides the words in both modes: the box hides, and a travel is told through `sheetOpen` (its surface's `hideWhy`, `travelling-box-sign.ts`), so it fades its words out by its own rules.
- The chip: every fitting narrated text in the station whose sign is mounted gets one; the shown text's follows its voice (`chipOf`), the others are `idle`. The sign last given the shown text's chip is remembered: once its text is no longer the shown one (the visitor left the station, or another text shows) it gets `chipOf(voice, false)` (paused, ended or idle), so a sign still standing outside the station (with "show all", or while it fades) never keeps saying "playing"; a sign no longer mounted is left alone. `setVoiceState` repaints only on a change. The voice's place stays the audio clock's, never the store's (a 60 Hz value would dispatch every frame). While the sheet is open in box mode the box is hidden, so the slice reads not playing and the chip shows the voice's place (paused or ended); the sheet covers the sign meanwhile.
- A voice does not follow the visitor out of its station.

## Leaving and coming back

Leaving a station pauses its voices by name (`pauseAll(stationId)`), and arriving at one calls `carryOn(stationId)`, so a voice picks up where the visitor left it. `stop` pauses without a name: nothing carries on after the session.

## Tests

- `captions-follow.test.ts` - `narratedShown`'s modes (Captions, a Reading pick, the creator's sign, neither), the creator's choice taken again, an unmet Lectern pick deferring to the creator's choice, a lectern, a stale timing and none passed over; `chipOf`; the box once the read-along fits, no box and no voice outside a station even when handed its blocks, pausing on leaving and on stop; one travel from the mounted sign, stopped on a switch to the box and on stop, on leaving the station, on the sign unmounting, on a remount under the same id and on another text; the box where the page cannot travel; the sheet hiding the words in both modes (the box the ghost while travelling); each fitting sign's chip, and a sign's chip let go of "playing" once its text is no longer shown.
