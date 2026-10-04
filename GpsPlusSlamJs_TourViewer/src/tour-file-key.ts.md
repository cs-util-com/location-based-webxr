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
  entries are skipped; names are relative to a folder EVERY entry shares;
  a name listed twice counts once (its last occurrence); the tour kit's
  own files (`tour.json`, `qr/<id>.json`, `content/*`) are left out
  whenever anything else remains. Rejects where WebCrypto is missing (an insecure
  origin); the open reports that like any failure.
- `isTourFileKey(key)` - true for a key made here.
- The prefix (`"local-file:"`) is module-private; `isTourFileKey` reads it.
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
- **A Finish keeps the key** (K0 milestone review R7, which found the draft
  orphaned on every Finish and on any re-zip). The first version keyed on
  every entry, so a finished tour (a changed `tour.json`, a new level, new
  photos) got a new key and the creator's draft - work placed after the
  Finish, and its storage - was left behind under the old one; this
  sidecar then claimed the draft was judged "exactly as for a link", which
  was not true: a link stays the same across a re-upload, the key did not.
  Now the files a Finish writes or removes are left out, so the recording
  a tour is built on names it, and a re-zip into a wrapping folder keeps
  it too.
- **No tour carries an identity of its own yet.** Searched 2026-10-04 in
  both repos: `tour.json` v1 has `version` and `objects` only,
  `session.json` carries timestamps but no id, and no `tourId` or
  `seriesId` exists anywhere; K1's `seriesId` (in the signed
  `manifest.json`, plan §8 G7) is the stable identity, and it replaces
  this key when it lands. Until then:
  - a hand-built tour (nothing but the tour kit's files) falls back to
    every entry, so a Finish still changes its key;
  - two tours built from the SAME recording on one device share a draft
    namespace. The draft is offered against the open manifest (only
    objects it does not already carry), never applied silently.
- No cache entry: a file is already on the device (saved tours are K3).
- The Drive replace step reads `hostedFileName()`, which for a file is the
  file's own name; `isDriveUrl` is false for a `local-file:` key, so the
  finish step offers the plain download.

## Tests

`tour-file-key.test.ts`: the key's shape and prefix, order and folder
entries not mattering, any changed CRC, size, name or file count changing
the key, and a property that two lists differing only in size never share
a key; stable across a Finish (a new `tour.json`, a level and photos) and
a re-zip into a folder, two recordings still apart, and the fallback for a
tour of only the tour kit's files (K0 milestone review R7).
