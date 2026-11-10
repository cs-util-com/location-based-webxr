# character-library.ts

**Purpose:** the on-device library of characters: one folder per character holding `frames.png` (the four-pose sheet), `image.png` (the first pose) and `character.json`, written last, so a folder without it is an unfinished save.

## Public API

- `LibraryStore { ids, read, write, remove }`: the device seam (`opfs-library-store.ts` in the page, an in-memory store in the tests).
- `createCharacterLibrary(store, clock?)` returns a `CharacterLibrary`:
  - `save(req)` (module-private `SaveRequest` shape): tidies away unfinished folders, writes the pictures, then the record. An empty name becomes the next free "Guide N" with `autoName: true`.
  - `list()`: `{ entries (newest first), interrupted }`; `interrupted` counts unfinished folders and records that do not read.
  - `rename(id, name)`, `remove(id)`, `files(id)` (`{ record, frames, image }`), `tidy()` (removes unfinished folders).
- Errors are plain `Error`s whose message is shown as is ("This character is no longer on this device.", a `nameProblem` text).

## Invariants

- `character.json` is always the last write of a save, so a reader never sees a record whose pictures are missing.
- A record that does not read (perhaps written by a newer version) is counted but never removed.

## Tests

`character-library.test.ts` (write order, automatic names, listing order, interrupted saves and their tidying, rename and remove, a failed write leaving no listed entry).
