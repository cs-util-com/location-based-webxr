# use-in-choices.ts

## Purpose

Where a file on the asset shelf may be used: the choices of the shelf
row's "Use in..." menu (the phone's way to do what a drop does on a
desktop), and the target a chosen key names. Pure data, no DOM.

## Public API

- `UseInChoice` - `{ key, label, icon }`; `icon` is `station`, `story` or
  `swap` (the panel maps it to its icon set).
- `UseInGroup` - `{ head, choices }`.
- `UseInTarget` - a `FileAddTarget` (`station` / `story`, as the add menu's)
  or `{ kind: "item", id }`.
- `useInChoices(asset, stations)` -> `UseInGroup[]`, for `asset` (`id`,
  `kind`), in this order:
  - "A new <word> in a station": every station, by its title. Left out for
    a kind that plays in a story only (a video).
  - "A new entry at the end of a story": every story, as
    "<story> - <station>".
  - "Replace the file of": every item of the asset's kind (free, in a
    folder or in a story) made from another file, as "<item> - <station>".
  - Empty groups are left out; a kind no item is made from (for example a
    timing text) has no choices at all.
- `useInTarget(key)` -> `UseInTarget | null`: `station:<id>`,
  `story:<id>`, `item:<id>`; null for anything else or an empty id.

## Invariants & assumptions

- The kind mapping is `fileAddKindOfAsset` (`../file-drop.ts`), and the
  file kind of a block is `blockFileKind` (`../../block-file.ts`), so the
  menu offers exactly what a drop or the session would accept.
- An item already made from this file is not offered (nothing would
  change).
- Whether a choice still holds when it is used is the session's call
  (`placeFileItem`, `setItemAsset`); this module only lists.

## Example

```ts
const groups = useInChoices({ id: "a1", kind: "audio" }, manifest.stations);
// [{ head: "A new sound in a station", choices: [{ key: "station:s1", ... }] }, ...]
useInTarget("story:st1"); // { kind: "story", storyId: "st1" }
```

## Tests

`use-in-choices.test.ts`: the groups per kind (a sound, a video without
the station group, a kind with no choices), stories in folders and
blocks inside stories, the current file left out, and the keys read
back.
