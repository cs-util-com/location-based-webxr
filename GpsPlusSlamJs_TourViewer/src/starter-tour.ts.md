# `starter-tour.ts` - the one packer of an empty tour

## Purpose

An empty tour is a zip holding only its `tour.json`. The start page's
starter zip and the desktop editor's new tour are both made here, so the
two never drift apart (one packer, not two copies).

## Public API

- `newTourManifest(mint = newTourId) -> TourManifest` - the empty
  manifest (`createEmptyTourManifest`) with a minted `tourId`.
  - Throws `RangeError` when `mint` gives an id outside the manifest's
    id rule (`TOUR_ID_PATTERN`): such an id is dropped on read, which
    would leave the tour keyed by its content again.
- `packStarterTour(manifest) -> Promise<Blob>` - the zip of that manifest
  as `tour.json` (`packFilesAsZip`).

## Invariants

- **Why the tour id:** a file-opened tour's draft is found by its file
  key (`tour-session.ts` `tourFileKeyOfFile`): a series id, else the
  `tourId`, else a content key. Two empty zips without an id are
  byte-identical, so they share one content key and the second would be
  offered the first one's draft. A minted id gives each its own key.
- Pure but for the random id; no DOM.

## Examples

```ts
const blob = await packStarterTour(newTourManifest());
```

## Tests

- `editor/new-tour.test.ts` - two new tours get two keys, one id one key,
  the id rule is enforced, and a property over valid ids.
