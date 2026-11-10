# asset-places.ts

## Purpose

Names where a tour uses one file: station card pictures, story entries,
free items, the characters drawn with it and the tour's cover, each with
the selection that shows it in the editor and the words that name it. The
asset shelf's "Used in" popover and its delete warning read it
(`shelf-panel.ts`). WHICH places use the file is not decided here: that
is the document's one walk (`fileUsesAll` / `fileUsesOf` in
`tour-document.ts`); this module only names the places it found.

## Public API

- `assetPlaces(stations, uses): AssetPlace[]`
  - `uses`: the file's `FileUses` (`fileUsesOf(state, id)`); `stations`:
    the tour as the next write carries it (`manifestToWrite`), for the
    names and the order.
  - `AssetPlace.selection`: `station:<id>` for a station picture, the
    block's own id for an item (a story entry is selected by its id, like
    the tree), `TOUR_COVER_SELECTION` for the cover (the page opens the
    tour's details), none for a character (his declaration has no row).
  - `AssetPlace.label`: `"<n> <station> › station picture"`,
    `"<n> <station> › <story> › <entry>"`, `"<n> <station> › <item>"`,
    `Character "<name>"` or `"The tour's cover"`.
- `TOUR_COVER_SELECTION`: the cover's selection.

## Invariants & assumptions

- Document order: stations in tour order; per station its picture, its
  stories' entries, then its free items (folders flattened by
  `tourFreeBlocks`); then the characters, then the cover.
- One place per block, card, character and the cover, as `fileUseCount`
  counts them, so the list's length matches the shelf row's
  `placesInUse` (both read the same `FileUses`).
- Names follow the editor's rules: `stationTitle` (an untitled station is
  "Station N"), `objectTitle` (an untitled item is its kind's name), an
  untitled story is "Story".
- Pure; nothing is changed.

## Example

```ts
const uses = fileUsesOf(state, "bells");
assetPlaces(manifestToWrite(state)?.stations ?? [], uses);
// [{ selection: "s1", label: "2 The old gate › The legend › Bells" }]
```

## Tests

`asset-places.test.ts`: all kinds of place in order (with the
characters and the cover), untitled names, and a file nothing uses.
