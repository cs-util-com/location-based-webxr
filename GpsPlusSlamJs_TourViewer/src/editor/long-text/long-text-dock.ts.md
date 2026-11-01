# long-text-dock.ts

## Purpose

The long text's part of the 3D view's inspector, put together: the
writer (`long-text-writer.ts`) the inspector shows while a free long text
is selected, the phone preview (`long-text-preview.ts`) over the 3D view,
the inspector's "Wider" width and whether the preview shows.

## Public API

- The head buttons it owns (`act`): `lt-preview`, `lt-wide`.
- `createLongTextDock(deps)` -> `LongTextDock`; deps: `document`, `box`,
  `inspectorRoot`, `treeRoot`, `kept`, `writeBody`, `writeView`,
  `loadPicture(path)`, `say`, `changed()` (its state changed outside a
  draw: the preview's own close or open button).
  - `sync(model | null)` - the inspector's long text; returns the
    writer's node to show, or null. The same model as last time does
    nothing (the shell draws five times a second).
  - `state()` - `{ preview, wide }` for the head buttons' pressed state.
  - `act(name)` - runs `lt-preview` or `lt-wide`; false for any other.
  - `flush()` - the writer's typing written now.

## Invariants & assumptions

- The preview exists only while a long text is selected; it opens shown
  (or as it was last left) and is removed with the selection.
- The inspector carries the class `lw` while it holds a writer and
  `lw-wide` while wider; the phone is laid out again once the width has
  eased (200 ms).
- The sheet's pictures are read by asset id through the tour's image
  assets.

## Tests

- Through the shell in a browser: `playwright-tests/editor3d-long-text.spec.js`.

## Narration

The dock passes the shell's `readNarration` / `editNarration` to the writer as `narration: { read, edit }`.
