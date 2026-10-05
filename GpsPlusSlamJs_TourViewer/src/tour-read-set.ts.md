# tour-read-set.ts

## Purpose

What a visitor of a tour reads, and the creator's walk a visitor never
reads (scan-pass plan
`2026-10-05-1240-tour-scan-pass-desktop-editor-and-partial-download-plan`,
S1 and owner decision S-D10). The Finish leaves the walk out of the
published copy unless the creator keeps it, and a visitor's page leaves it
out too.

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
- `scanEntryNames(entryNames, manifest, wrap) -> string[]` - the walk, in
  archive order: the entries a RECORDING writes (`session.json`, anything
  under `actions/`, `frame-NNNNNN.<ext>` in `images/` or the legacy
  `frames/`, the framework's `SESSION_IMAGES_DIR` and
  `LEGACY_SESSION_IMAGES_DIR`) that are not in `visitorEntryNames`. What a
  lean Finish removes.
- `entriesForVisitor(entries, scan) -> entries` - every entry except the
  walk, in archive order. The gallery and the photo ring use it.
- `stopsVisitorDownload(mode, scan) -> boolean` - true for a visitor of a
  copy that carries a walk: `archive-open.ts` then aborts the whole-file
  download.

## Invariants & assumptions

- **The walk is defined by what a recording writes, never as "everything
  a visitor does not read".** The first version used the latter: a
  creator's README, credits or licence file would have vanished from every
  published copy, and the "Keep the walk" box appeared for tours that have
  no walk. Depth samples travel inside the actions, so no separate depth
  folder exists to name.
- **No action stream, no walk.** The e2e tour fixture carries a
  `session.json` of its own and no actions. Both the first version and the
  narrowed one dropped it from the Finish, and the milestone browser run
  failed on exactly that entry twice. A `session.json` or a frame-named
  image counts as the walk only in an archive that has an `actions/` entry.
- A filter over the archive: a name the manifest carries but the archive
  lacks is never returned.
- Pure; the caller passes the manifest that will be WRITTEN (the Finish)
  so a photo placed in this Finish or a spot baked in it counts.
- A tour whose bake declined keeps its frames (the ring shows them) but
  loses its `session.json` and action stream.

## Examples

```ts
const leftOut = keepWalk ? [] : scanEntryNames(names, written, wrap);
```

## Tests

`tour-read-set.test.ts`: the full read set of a finished recording tour,
the ring's images without baked spots, a wrapped tour, names the archive
lacks; the walk of a baked tour (legacy `frames/` included), files a
recording never writes (README, credits, other folders, a non-frame image)
never in it, a tour without baked spots keeping its frames, no recording
no walk; the visitor filter and when the download stops (visitor mode
only, only with a walk). The Finish's use is in `creator-finish.test.ts`
("the published copy carries only what visitors need", a README kept).
