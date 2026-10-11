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
- `tourSeriesFileKey(seriesId)` - `local-file:series:<seriesId>`, the key
  of a file-opened tour that carries `manifest.json` (tour kit plan K1).
- `isTourFileKey(key)` - true for a key made here (both forms).
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
- **A tour with `manifest.json` is keyed by its series id** (tour kit
  plan K1, the K0 review's R7 follow-up): `local-file:series:<seriesId>`
  (`tourSeriesFileKey`), read in `tour-session.ts` before the session is
  built. The series id is the same for every version, every Finish and
  every re-zip, so the creator's draft stays attached across all of them.
  It is not verified at that moment; tier 1 checks the manifest (and its
  signature) when the session is built and fails the open if it lies. A
  manifest that does not parse falls back to the content key (tier 1 then
  reports it).
  - **One gap until K2:** a Finish drops `manifest.json` (the rewritten
    files would no longer match it), so the FINISHED zip opened from a
    file is keyed by content, and the draft made under the series key is
    not offered for it. K2's signed export writes the manifest again and
    closes the gap; until then this is one lost reattachment per Finish of
    a listed tour, and no listed tours exist outside the test fixtures.
- **Every other tour keeps the content key.** `manifest.json` and
  `manifest.sig.json` are among the tour kit's own files (a Finish drops
  them, K1), so the content key does not move when they come or go.
  - a hand-built tour (nothing but the tour kit's files) falls back to
    every entry, so a Finish still changes its key;
  - two tours built from the SAME recording on one device share a draft
    namespace. The draft is offered against the open manifest (only
    objects it does not already carry), never applied silently.
  - two tours that claim the same series id share one too; a forged
    claim is local (this device's own drafts) and tier 1 still has to pass.
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
