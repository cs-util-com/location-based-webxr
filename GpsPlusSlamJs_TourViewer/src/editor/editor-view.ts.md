# editor-view.ts

## Purpose

The desktop editor's page state that is not the tour (`editorView`):
what is selected, whether an edit or an open holds the page, the marker
being dragged and where it was dropped, the walk's flags, Done's and the
file picker's in-progress states, the card's last outcome line, and
whether a save waits to be delivered again. The tour itself is
`tourDocument`'s (`../tour-document.ts`); this slice is what the page's
chrome reads, one copy for every view of the page.

## Public API

- `EditorViewState`, `initialEditorViewState` - the fields:
  - `selected` - the selected item's id (the model's, `station:<id>` for
    a station), or null;
  - `busy` - an open (or another long step) holds the page's controls;
  - `moving` - `{ id, drop }`: the marker being dragged and the spot it
    was last dropped on (null until it moved), or null;
  - `keepsWalk` - the tour was opened to be saved in place: its saves keep
    the walk, even after a refusal turned them into downloads;
  - `openedWalk` - the opened file carries a walk, none of it moved out
    since (a save leaving it out offers "Save the debug data");
  - `doneBusy` - Done is saving before it opens its dialog;
  - `undelivered` - a save the browser did not deliver waits (the save
    itself, with its zip, stays the page's: Blobs are never state);
  - `message` - `{ id, text, refused? }`: the card's last outcome line,
    for the item it was said about;
  - `picking` - the browser's file picker is open.
- `editorViewActions`:
  - `selected({ id })`;
  - `busyChanged({ busy })`, `doneBusyChanged({ busy })`,
    `pickingChanged({ picking })`, `undeliveredChanged({ waits })`;
  - `moveStarted({ id })`, `moveDropped({ id, drop })`, `moveEnded()`;
  - `walkChanged({ keepsWalk?, openedWalk? })` - each given flag set;
  - `said({ message })` - the card's line, or none.
- `editorViewReducer`, `selectEditorView(root)`.
- `MapSpot`, `EditorMoving`, `EditorMessage` - the payload shapes.

## Invariants & assumptions

- **Desktop only.** `edit-main.ts` mounts it through
  `createTourViewerStore(undefined, { editorView })`; the phone's store
  never names it, and a key one of the store's own slices has is refused
  there.
- **Not an edit.** No history, no draft write, no revision: nothing here
  is the tour.
- **The drag guard.** A drop is kept only for the marker being dragged
  (a late map event for another, or after the drag ended, changes
  nothing) and only for a spot with finite coordinates: a commit moves the
  item to `drop`, so a spot nobody can draw never reaches it.
- **Setters, not rules.** `selected` does not clear `message`: the page
  says when a line goes (`select`, an undo, a delivered save), as it did
  with its module variables. Each action changes only the field it names.
- **Kept out on purpose:** the drag preview and the camera target are
  scene resources, and the set of items moved since the last save
  (`moved`, a `Set` the card reads) stays the page's; nothing is
  dispatched per frame.

## Examples

```ts
const store = createTourViewerStore(undefined, {
  editorView: editorViewReducer,
});
store.dispatch(editorViewActions.moveStarted({ id: "a" }));
store.dispatch(
  editorViewActions.moveDropped({ id: "a", drop: { lat: 48.5, lng: 9.05 } }),
);
selectEditorView(store.getState()).moving; // { id: "a", drop: {...} }
```

## Tests

`editor-view.test.ts`: the initial state; a drop kept only for the
marker being dragged and only for a drawable spot (another marker's late
event, NaN, Infinity and a drop after the drag ended all ignored); each
flag set on its own, and `selected` keeping the line; the slice mounted
beside the shared ones by `createTourViewerStore`, a colliding key
refused, and the phone's store without it. The page's use of it is
covered by `playwright-tests/editor.spec.js` (the 2D editor's walks:
selection, drag, Done, the picker, the walk).
