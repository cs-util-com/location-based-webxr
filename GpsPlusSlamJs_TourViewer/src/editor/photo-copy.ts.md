# editor/photo-copy.ts

## Purpose

Keeps the session the desktop editor's card reads its photos from once a
save replaced the bytes the opened file had (E2b plan review #2, #5): the
newest written copy, opened ONE AT A TIME. Each open starts that
session's whole-archive check (`tour-session.ts`), which hashes a listed
tour's entries again (about 6 s per GiB) and cannot be stopped; opened
after every autosave, those checks piled up (E2b-2 milestone review #3).

## Public API

- `createPhotoCopies<S extends PhotoCopy>(open): PhotoCopies<S>` -
  `open(file)` opens a session over a written copy (the page passes
  `openTourFile`); a rejection keeps the current copy.
- `PhotoCopy` - `wholeArchiveCheck: Promise<unknown>` (its background
  check) and `close()`.
- `PhotoCopies`
  - `current()` - the copy photos read from now; null before any save.
  - `use(file, live)` - `file` is the newest written copy, `live()` whether
    it is still the open tour's. With no check running it opens at once
    and resolves once it is current (or did not open); with one running it
    waits, replacing any copy that was waiting before it, and resolves at
    once.
  - `clear()` - the tour closed: the current copy closes, a waiting one is
    dropped.

## Invariants & assumptions

- At most one copy's whole-archive check runs at a time, across tours too:
  `clear()` does not end the wait for a check still running.
- Only the newest waiting copy opens: the ones in between are never opened.
- A copy that opens after its tour closed (`live()` false) is closed at
  once and never becomes current; the replaced current copy is closed.
- Meanwhile the photos read from the last copy that opened. Its bytes are
  the page's own (the save's `Blob`), so they still read, even though a
  newer save wrote other bytes to disk.
- A check that rejects counts as finished.

## Examples

```ts
const photos = createPhotoCopies((file) => openTourFile(file));
await photos.use(new File([save.blob], save.filename), () => editor === mine);
const open = photos.current() ?? session;
photos.clear(); // another tour opens
```

## Tests

`photo-copy.test.ts`: the first copy opens at once; a copy saved during a
check waits and opens after it; only the newest of several waiting copies
opens; a copy whose tour closed is closed and not current; `clear()` drops a
waiting copy and closes the current one; a failed open keeps the current
copy. The page's use is covered by the autosave walks in
`playwright-tests/editor.spec.js`.
