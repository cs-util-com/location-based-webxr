# tour-files.ts

## Purpose

Reads a file brought into the open tour (a voice now; pictures, videos,
sounds and models once the add flow lands): its bytes at once, checked
against what a tour can carry, named by its content hash. The same bytes
are one entry of the zip however many items use them. Page-free: the
editor session keeps what it returns in its one files table
(`editor-session.ts`), and the draft keeps it across a reload
(`editor-draft.ts`).

## Public API

- `readTourFile(file, fileName, context): Promise<TourFileRead | TourFileRefusal>`
  - never rejects: every failure is `{ kind: "refused", reason }` in plain
    words, for the page's toast.
  - `TourFileRead`: `{ kind: "read", asset, blob, isNew, poster? }` -
    `asset` is `content/<sha256>.<ext>` of the kind its extension names
    (an image with its pixel size); `blob` is a copy in memory with the
    type's MIME; `isNew` false when the tour already holds these bytes
    (`context.known`), then nothing is added. A video's minted poster
    rides along by the same rule.
- `TourFileContext`
  - `tourBytes` - what the tour weighs now (`EditorSession.tourBytes()`).
  - `known(sha)` - the asset the tour holds for these bytes.
  - `kinds?` - the kinds taken here (the voice import takes `audio`).
  - `measureModel?(blob)` - a model's largest side; 0 (or not finite)
    refuses it as showing nothing, a rejection as unreadable.
  - `posterOf?(blob)` - a video's poster picture; null or a rejection
    mints none.
  - `limits?` - `TourFileLimits`, default `TOUR_FILE_LIMITS`.
- `TOUR_FILE_LIMITS` - the archive reader's caps
  (`DEFAULT_ARCHIVE_LIMITS`: an entry 256 MiB, an archive 1024 MiB) less a
  4 MiB margin for the manifest, the lists and the zip's own records, so
  a tour the editor took is one every reader opens.

## Invariants & assumptions

- Order of checks: the extension's type (and `kinds`), the entry cap, the
  room in the tour, the read (a dropped `File` whose source moved or went
  is refused here, never later at a save), the kind's own rule, the hash.
- A kind's own rule: an image's size read from its header and within
  `TOUR_MAX_IMAGE_PIXELS`; a model inert (`checkGlbInert`) and, when a
  measurer is given, with a shape; other kinds pass.
- An asset of the same hash but another kind is not reused: a new asset
  of this kind is made.
- A poster that is no picture a tour takes, or that would not fit, is
  dropped; the video is still read.
- The whole file is held in memory once (the copy); the hash reads it
  once more. Measured in desktop Chromium (random bytes, one voice):
  - 25 MiB: hash 34 ms, `addFile` (read, hash, draft write) 145 ms, save 385 ms.
  - 64 MiB: 72 ms, 356 ms, 971 ms.
  - 128 MiB: 186 ms, 1.2 s, 1.9 s.
  - 250 MiB: 355 ms, 1.3 s, 2.3 s.
  - 256 MiB: refused in words (over the 252 MiB a file may take).
  - A phone is slower; these are an order, not a promise.

## Examples

```ts
const read = await readTourFile(file, file.name, {
  tourBytes: editor.tourBytes(),
  known: (sha) => assets.find((a) => a.id === sha),
  kinds: ["audio"],
});
if (read.kind === "refused") toast(read.reason);
```

## Tests

`tour-files.test.ts`: the read at the drop (a source that changes or
fails afterwards), the hash naming, reuse of held bytes, the type refusal
naming the types taken, the entry and archive caps (and that they stay
below the reader's), models that are not inert, show nothing or cannot be
measured, the image pixel cap, and a minted poster.
