# finish-entries.ts

## Purpose

The files a Finish writes into the rebuilt zip: every level it is given,
the manifest, and the photos' bytes (code book refactor plan
`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`,
M1). Extracted from the Finish handler in `creator-setup.ts`, where it was
assembled inline for exactly one code; it takes a list so M4 can write
every changed code (`code-book.ts` `codesToWrite`). Pure.

## Public API

- `finishEntries({ entryNames, levels, wrap, listed, manifestPath,
manifestJson, photos }): FinishEntry[]` - levels first (in order), then
  the manifest, then each photo at `${wrap}${image}`.
- `interface FinishEntry { path, data: string | Blob }`.

## Invariants & assumptions

- A level the zip already holds is replaced where it is, found by its id
  in the entry names (`qrLevelIdFromEntryName`) - also in the tolerated
  wrapped shape `mytour/qr/<id>.json`: a second copy at the root would be a
  stale duplicate on every Finish.
- A new level goes inside the tour's folder for a listed tour (its signed
  file list can then name it, K1 milestone review R7), else at the root.
- No levels: only the manifest and the photos (a Finish that changed
  objects only).
- The caller appends the signed file list after these entries (it hashes
  them).

## Examples

```ts
const entries = finishEntries({
  entryNames,
  levels: [minted],
  wrap,
  listed: listed !== null,
  manifestPath,
  manifestJson: serializeTourManifest(written),
  photos,
});
```

## Tests

`finish-entries.test.ts`: a new level at the root, a held level replaced in
place in a wrapped zip, a listed tour's new level inside its folder, two
levels, none, and photo paths. The Finish's composed behaviour stays
covered by `creator-finish.test.ts` and `authoring-settle.test.ts`.
