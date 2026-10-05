# tour-read-set.ts

## Purpose

What a visitor of a tour reads (scan-pass plan
`2026-10-05-1240-tour-scan-pass-desktop-editor-and-partial-download-plan`,
S1 and owner decision S-D10): the entries the published copy keeps, and
the only ones a visitor's viewer needs. Everything else in an archive is
the creator's (the walk recording, its unbaked frames, depth) and the
Finish leaves it out unless the creator keeps it.

## Public API

- `visitorEntryNames(entryNames, manifest, wrap) -> Set<string>` - the
  entries of `entryNames` a visitor reads:
  - `${wrap}tour.json`;
  - every code level (`qrLevelIdFromEntryName`, wherever it sits: an
    unlisted tour keeps its levels at the root);
  - the signed list and its signature (`signedManifestFilesOf`);
  - each photo object's and each asset's file, under `wrap`;
  - the photos `captureSpots` names (the recording's own entry names);
  - for a tour WITHOUT baked spots, every image entry, because that is
    what the photo ring shows.
- `scanEntryNames(entryNames, manifest, wrap) -> string[]` - the rest, in
  archive order: what a lean Finish removes.

## Invariants & assumptions

- A filter over the archive: a name the manifest carries but the archive
  lacks is never returned.
- Pure; the caller passes the manifest that will be WRITTEN (the Finish)
  so a photo placed in this Finish or a spot baked in it counts.
- A tour whose bake declined keeps its images (the ring) but loses its
  walk: the walk is never what a visitor reads.

## Examples

```ts
const leftOut = keepWalk ? [] : scanEntryNames(names, written, wrap);
```

## Tests

`tour-read-set.test.ts`: the full read set of a finished recording tour,
the ring's images without baked spots, a wrapped tour, names the archive
lacks, the scan of a baked tour and an empty scan. The Finish's use is in
`creator-finish.test.ts` ("the published copy carries only what visitors
need").
