# file-drop.ts

## Purpose

Where a file dropped in the open editor goes, read from what it was
dropped on, and which kind of item it makes. The page (`edit-main.ts`
`dropFiles` and the document's drag listeners) does the drop; this reads
the drawn elements' data and the file's name and changes nothing.

## Public API

- `FileDropTarget` - a `FileAddTarget` (`station` / `story`, as the add
  menu's) or `{ kind: "item", id }` (an item's file field).
- `FILE_FIELD_ATTR` (`data-filefield`) - the attribute an item's file
  field carries, the block's id (`editor-shell/inspector-file.ts`).
- `fileAddKindOfAsset(kind)` -> `FileAddKind | null`: the add kind an asset
  kind is the file of (`image` is a picture); null for a kind no item is
  made from.
- `fileAddKindOf(fileName)` -> `FileAddKind | null`: by the extension,
  any case, through the tour's media allowlist (`tourMediaTypeOf`) and the
  kind whose `add.file` is that asset kind; null for anything a tour does
  not take (a zip, a text, no extension).
- `fileDropTarget(element, tree)` -> `FileDropTarget | null`: an item's
  file field first (anywhere on the page), then a station's or a story's
  row inside `tree` (from any child of the row, by its `data-select`);
  null for an item's row, a header, an empty id, anything outside.
- `dragHasFiles(event)` - whether a drag carries files (not a row of the
  tree being dragged, not text).

## Invariants & assumptions

- Pure reads, no I/O, no state.
- A null target means the shelf only: the page still puts the file on the
  shelf (`addToShelf`).
- A file whose kind cannot stand where it is dropped (a video on a
  station's row) is refused later by the add flow, in words.

## Examples

```ts
fileDropTarget(rowChild, treeAside); // { kind: "story", storyId: "st1" }
fileAddKindOf("statue.GLB"); // "model"
```

## Tests

`file-drop.test.ts`; the file field's id through
`editor-shell/inspector-file.test.ts`; the whole drop in the e2e
`playwright-tests/editor3d-shelf.spec.js`.
