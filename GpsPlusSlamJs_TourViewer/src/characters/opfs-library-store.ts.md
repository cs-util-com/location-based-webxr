# opfs-library-store.ts

**Purpose:** the character library's device store: the origin private file system, one folder per character under `characters/`. Same origin, so the tour editor on this device reads the same library.

## Public API

- `opfsLibraryStore(): Promise<LibraryStore>`; throws `LibraryUnavailable` (with words to show) when the browser gives the page no private file system.

## Invariants

- `read` answers `null` for a missing folder or file; removing a missing folder is not an error; a failed `write` aborts its writable so no half-written file is kept.

## Tests

The device seam, covered by `playwright-tests/character-maker.spec.js` (save, list after a reload, a failed write); the library rules above it by `character-library.test.ts` with an in-memory store.
