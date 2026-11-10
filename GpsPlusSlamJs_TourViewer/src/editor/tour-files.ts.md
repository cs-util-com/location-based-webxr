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
    rides along by the same rule. `oversized: true` - a file over the
    entry cap or a picture over the pixel cap that `context.shrinks` took
    to be made smaller: no save writes it until a smaller file replaces it
    (`tour-document-save.ts` refuses the save in words).
- `TourFileContext`
  - `tourBytes` - what the tour weighs now (`EditorSession.tourBytes()`).
  - `known(sha)` - the asset the tour holds for these bytes.
  - `kinds?` - the kinds taken here (the voice import takes `audio`).
  - `measureModel?(blob)` - a model's largest side; 0 (or not finite)
    refuses it as showing nothing, a rejection as unreadable.
  - `shrinks?(kind)` - whether a file of that kind over the caps may come
    in to be made smaller. The editor session passes it from the shelf's
    optimizer table (`optimizerShrinks`), false for every kind in this
    build. Absent: none may, and the refusal is the plain cap's. Present
    but false for the kind: the refusal adds that this kind cannot be made
    smaller here yet. Either way never above the absolute ceilings:
    `ASSET_CEILING_BYTES` (512 MiB, `limits.ceilingBytes` overrides it) and
    `ASSET_CEILING_PIXELS` (8192 x 8192, a 48 MP photo fits), both
    PROVISIONAL until a phone memory measurement sets them; they guard the
    decode against huge files and crafted headers.
  - `videoLookOf?(blob)` - a video's poster picture and length, read
    through one element (`video-poster.ts`); a null poster or a rejection
    mints none, a null length leaves `seconds` out. A video read gives
    `seconds` when its length was known (the shelf's size warning).
  - `limits?` - `TourFileLimits`, default `TOUR_FILE_LIMITS`.
- `TOUR_FILE_LIMITS` - the archive reader's caps
  (`DEFAULT_ARCHIVE_LIMITS`: an entry 256 MiB, an archive 1024 MiB) less a
  4 MiB margin for the manifest, the lists and the zip's own records, so
  a tour the editor took is one every reader opens.

## Invariants & assumptions

- Order of checks: the extension's type (and `kinds`), the entry cap, the
  read (a dropped `File` whose source moved or went is refused here, never
  later at a save), the hash, the room in the tour, the kind's own rule.
  The room counts only what the import ADDS (a new asset, a new poster):
  bytes the tour already holds are taken however full it is.
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
fails afterwards), the hash naming, reuse of held bytes (also in a tour at its cap), the type refusal
naming the types taken, the entry and archive caps (and that they stay
below the reader's), models that are not inert, show nothing or cannot be
measured, the image pixel cap, a minted poster, and the over-cap rules (a
kind that shrinks taken over the entry cap and the pixel cap, never above
the ceilings; a kind that cannot shrink refused in words).
