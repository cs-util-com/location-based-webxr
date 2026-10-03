# tour-file-key.ts

## Purpose

The key a tour opened from a FILE is known by, in place of a link: the
draft store's namespace, the open tour's `archive.url`, and the comparison
key a scanned code is checked against. Tour kit plan K0
(`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`,
cold-review G3: "open a file" needs its own cache and draft key).

## Public API

- `tourFileKey(entries): Promise<string>` - `local-file:` plus the first
  32 hex digits (128 bits) of the SHA-256 of the entry list: one line per
  file entry, `name NUL unpacked size NUL CRC-32`, sorted. Directory
  entries are skipped. Rejects where WebCrypto is missing (an insecure
  origin); the open reports that like any failure.
- `isTourFileKey(key)` - true for a key made here.
- `TOUR_FILE_KEY_PREFIX = "local-file:"`.
- `interface TourFileKeyEntry { filename; directory?; uncompressedSize; crc32? }`
  (zip.js `Entry` satisfies it).

## The decision: a content key from the central directory

Candidates weighed (2026-10-03):

- **File name + size + modification time** - free, but a phone saves a
  second download of the same tour as `tour (1).zip` with a new time, so
  the creator's draft would be orphaned by the most ordinary action there
  is; and two different tours could share all three.
- **SHA-256 of the whole file** - exact, but WebCrypto has no streaming
  digest: a 270 MB recording would sit in memory on a phone just to name it.
- **SHA-256 of the central directory's entry list (chosen)** - the names,
  unpacked sizes and CRC-32s ARE the content's identity, the directory is
  read to open the tour anyway, and hashing a few thousand lines takes
  milliseconds. The compressed size is left out, so the same files re-zipped
  at another level keep their key; the order is sorted, so a re-zip that
  reorders entries does too.

Consequences:

- Same entries, any file name or date: same key, so the draft reattaches.
- A finished tour (a changed `tour.json`) has a new key - as a re-uploaded
  zip is new content behind the same link. The old key's draft is judged
  against the manifest it was made for, exactly as for a link.
- No cache entry: a file is already on the device (saved tours are K3).
- The Drive replace step reads `hostedFileName()`, which for a file is the
  file's own name; `isDriveUrl` is false for a `local-file:` key, so the
  finish step offers the plain download.

## Tests

`tour-file-key.test.ts`: the key's shape and prefix, order and folder
entries not mattering, any changed CRC, size, name or file count changing
the key, and a property that two lists differing only in size never share
a key.
