# tour-signed-manifest.ts

**Purpose:** `manifest.json`, the list of a tour archive's files that a
signature vouches for - every file's SHA-256 and size, the tour's series
id and version number, links to other series, a reserved recovery-key
commitment - and the TIER 1 check of an archive's entries against it.
Tour kit plan K1, §4.1, §8 D3, D4, G7
(`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`).
Pure: no I/O, no crypto, no zip library. The signature itself is
`tour-signature.ts`; reading the list out of an open archive is the Tour
Viewer's `tour-integrity.ts`.

## Public API

- `SIGNED_MANIFEST_ENTRY = "manifest.json"`, `MANIFEST_SIGNATURE_ENTRY =
"manifest.sig.json"`, `SIGNED_MANIFEST_FORMAT = 1`,
  `MAX_SERIES_LINKS = 64`.
- `parseSignedTourManifest(text): SignedTourManifest` - throws
  `TourIntegrityError` (`malformed-manifest`, or `newer-format` for a
  format above 1). Unknown fields are ignored (the signature covers them).
- `serializeSignedTourManifest(manifest): string` - pretty JSON,
  re-validated through the parser (for K2's signer and the test fixtures).
- `canonicalTourPath(name): string | null` - `./` segments dropped; null
  for empty, absolute, drive-lettered, backslashed, `..`, empty-segment or
  directory names.
- `signedManifestEntryOf(names): string | null` - the shallowest
  `manifest.json` (a wrapping folder is tolerated, like `tour.json`).
- `checkEntriesAgainstManifest(entries, manifest, manifestEntryName):
Map<filename, TourFileRecord>` - TIER 1; throws `TourIntegrityError`.
- `TourIntegrityError { kind }` with `kind` one of `malformed-manifest`,
  `newer-format`, `malformed-signature`, `bad-signature`, `unsafe-name`,
  `duplicate-name`, `unlisted-file`, `missing-file`, `size-mismatch`,
  `hash-mismatch`. The message is the technical detail; the page words it.
- Types `SignedTourManifest`, `TourFileRecord { sha256, size }`,
  `TourSeriesLink { seriesId, author }`, `TourArchiveEntryInfo`,
  `TourIntegrityKind`.

## The format

```json
{
  "formatVersion": 1,
  "seriesId": "K7fQ2mX9pL4sT8vB1nR6wA",
  "version": 3,
  "createdAt": "2026-10-04T08:00:00.000Z",
  "files": { "tour.json": { "sha256": "<64 hex>", "size": 120 } },
  "links": [{ "seriesId": "...", "author": "did:key:z6Mk..." }],
  "recoveryKeyCommitment": "<64 hex, optional, reserved>"
}
```

- `seriesId`: 16-64 base64url characters, random and stable across every
  version of one tour (K2 writes 22: 128 bits).
- `version`: an integer >= 1 that only grows (the rollback warning is K3).
- `files`: keys are canonical paths RELATIVE TO THE MANIFEST'S FOLDER;
  values the SHA-256 (lowercase hex) and size of the DECOMPRESSED bytes,
  read through the same zip.js path the reader uses.
- `links`: at most 64; each author an Ed25519 did:key.
- `recoveryKeyCommitment` (reserved, K-D2/K-D8): the SHA-256 hex of the
  spare key's did:key, named in advance so a stolen main key can be
  replaced. Shape-checked, not acted on.
- `previousManifestSha256` is not part of the format (dropped, §8 G7).

## Canonicalisation rules (§8 D4)

- Paths are relative to the manifest's folder, `./` normalised away.
- Unsafe names are refused outright in a signed archive.
- The same canonical name twice is refused, in the zip and in `files`.
- Directory entries are ignored.
- `manifest.json` and `manifest.sig.json` (in the manifest's folder) are
  never in `files`, and are skipped when the archive is checked.
- An entry outside the manifest's folder is an unlisted file.

## Invariants & assumptions

- Tier 1 compares DECLARED sizes from the central directory; it cannot see
  content. The hashes are checked per read (tier 2) and over the whole
  archive (tier 3) by the Tour Viewer; zip.js also checks an entry's
  inflated length against its declared size.
- The number of files is bounded by the archive's own entry cap (K0,
  20,000): every listed file must match an entry, so no separate cap.
- The manifest text is read under the K0 text cap (16 MiB). The largest
  real archive (3,465 entries) would make a manifest of about 0.5 MB.

## Sweep: the links cap

- `MAX_SERIES_LINKS = 64`. Need: the castle example links 0-2 series; no
  creator has a key yet (K2). 64 still fits a phone list and bounds what a
  crafted file can make the page render. A creator who links more than 64
  of their own series from one tour would reverse it.

## Examples

```ts
const manifest = parseSignedTourManifest(text);
const records = checkEntriesAgainstManifest(
  zipEntries,
  manifest,
  'manifest.json'
);
records.get('content/gate.jpg'); // { sha256, size }
```

## Tests

- `tour-signed-manifest.test.ts` - canonical paths, every field and every
  refusal, the round trip, the manifest entry lookup, and each tier-1
  failure kind.
- `tour-signed-manifest.property.test.ts` - generated listings are
  accepted in any order and under any `./` spelling with the same records;
  any entry repeated under any spelling is refused; one file more, one
  fewer or one size changed is refused.
