# tour-integrity.ts

## Purpose

The archive side of a tour's `manifest.json` (tour kit plan K1, §8 D3,
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`):
reading the list out of an open archive and checking the archive against
it in THREE TIERS, so a range-streamed tour is checked as its bytes arrive
rather than only after a download that may never finish. The format and
its canonicalisation rules live in the framework
(`ar/tour-signed-manifest.ts`); this module feeds it the archive.

## Public API

- `openTourIntegrity(entries, readBytes): Promise<TourIntegrity>` - TIER 1
  at open. Without `manifest.json` it returns `{ kind: "none" }`; with one
  it reads the manifest's bytes through `readBytes` (the session's capped
  reader), decodes them as strict UTF-8, parses them and checks every file
  entry's name and declared size, returning `{ kind: "listed", manifest,
manifestEntry, manifestSha256, records }`. Throws `TourIntegrityError`.
- `checkEntryBytes(integrity, filename, bytes)` - TIER 2: one entry's
  decompressed bytes against its size and SHA-256. Entries without a
  record (the manifest, its signature) and every entry of a tour without a
  manifest pass. Throws `hash-mismatch`.
- `checkWholeArchive(blob, limits): Promise<TourIntegrity>` - TIER 3: a
  complete copy opened through the same capped zip.js path, tier 1 run on
  it, then every listed entry hashed. Returns the copy's own tier-1 result.
- `integrityIdentity(integrity): string | null` - the manifest's hash, or
  null without one: two copies of one tour have the same identity.
- `class TourIntegrityGuard` - a session's latch for LATE failures:
  `checked(filename, blob)` runs tier 2 on a read's blob, `fail(err)`
  keeps the FIRST failure and reports it once, `assertIntact()` throws it,
  `failure` reads it. Once latched, every read rejects with it.
- `class WholeArchiveCheck` - tier 3 for one open: `accept(blob)` (what
  `openRemoteArchive` calls as `acceptLocalCopy`, and what the session calls
  for a saved copy or the file) checks a complete copy and rejects when it
  fails or cannot be read, so the copy is never used or cached;
  `bind(expected, onFailure)` hands it the session's tier-1 identity (a
  copy accepted before - an eager download is checked inside the open - is
  compared then); `notChecked()` when no complete copy will come; `done`
  resolves `checked | failed | not-checked`.
- Types `TourIntegrity`, `WholeArchiveOutcome`.

## Invariants & assumptions

- A tour without a manifest (every tour made before K1) is not an error:
  it opens as before, its reads are not hashed, and the page calls it
  unsigned. Tier 3 on such a copy is a directory read and finds nothing.
- `records` is keyed by each entry's OWN filename (`./x` stays `./x`), the
  name every later read looks up.
- Tier 3 compares IDENTITIES: a complete copy must carry the same manifest
  bytes the session opened with. A host that swapped the archive mid-
  session (same size, other content) is a late failure even when the new
  copy is self-consistent.
- A copy that cannot be read whole (a cap, a broken zip) is refused for
  the cache but is not an integrity failure (`not-checked`); tier 2 still
  guards every read.
- Invalid UTF-8 in the manifest is `malformed-manifest`, never a lossy
  decode: the signature covers bytes, the parser reads text.
- Cost: hashing holds one entry at a time in memory (WebCrypto has no
  streaming digest), bounded by the K0 per-entry cap; tier 3 hashes the
  whole archive once per complete copy, in the background for a saved
  copy or a file, inside the warm download for a link.

## Tests

`tour-integrity.test.ts`:

- tier 1: a listed tour opens and exposes its manifest; a tour without one
  opens as before; a wrapped `./` tour opens; an extra file, a missing
  file, a changed size, a repeated name (byte-patched, as zip.js will not
  write one), the same file under two spellings and a malformed manifest
  each fail the open with their kind - over a link and over a file;
- tier 2: a changed entry fails its read, is reported once, and every
  later read fails too; honest entries read through; any single flipped
  byte fails (property); the recording's action entries are hashed;
- tier 3: a matching warm copy is checked and cached; a mismatching one
  fails late, is never cached and stops every read; a whole download at
  open is checked inside the open and never cached; a saved copy is
  re-checked in the background and dropped; a file is checked as a whole;
  a tour without a manifest is `checked` with a cache and `not-checked`
  without one.

Mutation check (2026-10-04): unhooking `acceptLocalCopy` turns four tier-3
tests red; skipping the tier-2 hash turns three tier-2 tests red.
