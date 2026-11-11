# character-library.ts

**Purpose:** the on-device library of characters: one folder per character holding `frames.png` (the four-pose sheet), `image.png` (the first pose) and `character.json`, written last, so a folder without it is a save under way or an interrupted one. Only one older than `UNFINISHED_AGE_MS` (10 minutes, by the time in its id; an id with no time counts as old, one dated ahead of the clock counts as young) is taken as interrupted; a younger one may be another tab's save in flight and is left alone. Ten minutes covers a save (under a second even on a slow phone) and a background tab the browser froze mid-save, with room; the cost is only that a real leftover waits that long.

## Public API

- `LibraryStore { ids, read, write, remove }`: the device seam (`opfs-library-store.ts` in the page, an in-memory store in the tests).
- `createCharacterLibrary(store, clock?)` returns a `CharacterLibrary`:
  - `save(req)` (module-private `SaveRequest` shape): tidies away interrupted folders, writes the pictures, then the record. An empty name becomes the next free "Guide N" with `autoName: true`.
  - `list()`: `{ entries (newest first), interrupted }`; `interrupted` counts interrupted folders and records that do not read.
  - `rename(id, name)`, `remove(id)`, `files(id)` (`{ record, frames, image }`), `tidy()` (removes interrupted folders).
  - `UNFINISHED_AGE_MS`: the age above.
- Errors are plain `Error`s whose message is shown as is ("This character is no longer on this device.", a `nameProblem` text).

## Invariants

- `character.json` is always the last write of a save, so a reader never sees a record whose pictures are missing.
- A record that does not read (perhaps written by a newer version) is counted but never removed.

## Tests

`character-library.test.ts` (write order, automatic names, listing order, interrupted saves and their tidying, a folder's age swept from an hour in the future to an hour past the cap, another tab's save in flight surviving a save here, an id with no time, rename and remove, a failed write leaving no listed entry).
