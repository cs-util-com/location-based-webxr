# asset-places.ts

## Purpose

Lists where a tour uses one file: station card pictures, story entries
and free items, each with the selection that shows it in the editor and
the words that name it. The asset shelf's "Used in" popover and its
delete warning read it (`shelf-panel.ts`).

## Public API

- `assetPlaces(stations, assetId): AssetPlace[]`
  - `AssetPlace.selection`: `station:<id>` for a station picture, else the
    block's own id (a story entry is selected by its id, like the tree).
  - `AssetPlace.label`: `"<n> <station> › station picture"`,
    `"<n> <station> › <story> › <entry>"` or `"<n> <station> › <item>"`.

## Invariants & assumptions

- Document order: stations in tour order; per station its picture, its
  stories' entries, then its free items (folders flattened by
  `tourFreeBlocks`).
- A block naming the file twice is one place, as in `assetUsesOf`'s
  count, so the list's length matches the shelf row's `placesInUse` for
  the same manifest.
- Names follow the editor's rules: `stationTitle` (an untitled station is
  "Station N"), `objectTitle` (an untitled item is its kind's name), an
  untitled story is "Story".
- Pure; the stations are read, never changed.

## Example

```ts
assetPlaces(manifest.stations, "bells");
// [{ selection: "s1", label: "2 The old gate › The legend › Bells" }]
```

## Tests

`asset-places.test.ts`: all three kinds of place in order, untitled
names, and a file nothing uses.
