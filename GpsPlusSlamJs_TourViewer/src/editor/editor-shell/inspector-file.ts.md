# inspector-file.ts

## Purpose

The selected item's file in the inspector: which block a "File" row is for
and the name it shows, and the row itself with its "Replace...". The row
carries the block's id in `data-filefield`, so a file dropped on it
becomes the item's file (`../file-drop.ts`, page `useAsItemFile`).

## Public API

- `InspectorFile` - `{ blockId, name }`.
- `REPLACE_FILE_ACT` (`"file"`) - the button's `data-act`; the shell
  answers it with `deps.edits.replaceFile(blockId)`.
- `inspectorFileOf(selected, stations, assets, nameOf?)` -> the file of a
  block made from a file (free, in a folder or in a story), named by
  `nameOf` (the shelf's name it came in under) or the entry's last part;
  null for nothing, a station, a story, words, or a file the tour does not
  list.
- `fileBlockOf(id, stations)` -> that block, or null (the page uses it to
  pick a file of the block's own kind).
- `fileFieldPart(file)` -> the row: "File", the name (ellipsised, its full
  name in the title), "Replace...".

## Invariants & assumptions

- The shell adds `file` to the inspector's model (`InspectorModel.file`),
  so a file swapped under the same id redraws the row (the model's JSON is
  the draw key).
- Pure apart from building the row's DOM.

## Tests

`inspector-file.test.ts`; the session's swap in
`../editor-session-add-file.test.ts`.
