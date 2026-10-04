# tour-integrity.ts

## Purpose

The archive side of a tour's `manifest.json` (tour kit plan K1, §8 D3,
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`):
reading the list out of an open archive and checking the archive against
it. The format and its canonicalisation rules live in the framework
(`ar/tour-signed-manifest.ts`); this module feeds it the archive.

## Public API

- `openTourIntegrity(entries, readBytes): Promise<TourIntegrity>` - TIER 1
  at open. Without `manifest.json` it returns `{ kind: "none" }`; with one
  it reads the manifest's bytes through `readBytes` (the session's capped
  reader), decodes them as strict UTF-8, parses them and checks every file
  entry's name and declared size, returning `{ kind: "listed", manifest,
manifestEntry, manifestSha256, records }`. Throws `TourIntegrityError`.
- `type TourIntegrity`.

## Invariants & assumptions

- A tour without a manifest (every tour made before K1) is not an error:
  it opens as before and the page calls it unsigned.
- `records` is keyed by each entry's OWN filename (`./x` stays `./x`), the
  name every later read looks up.
- `manifestSha256` is the identity of what tier 1 checked: a later whole-
  archive check must find the same manifest bytes.
- Invalid UTF-8 in the manifest is `malformed-manifest`, never a lossy
  decode: the signature covers bytes, the parser reads text.

## Tests

`tour-integrity.test.ts`: a listed tour opens and exposes its manifest; a
tour without one opens as before; a wrapped `./` tour opens; an extra
file, a missing file, a changed size, a repeated name and a malformed
manifest each fail the open with their kind - over a link and over a file.
