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
  - `picking` - the browser's file picker is open;
  - `viewMode` - `"2d"` (the map) or `"3d"` (the 3D view shows);
  - `view3dLoad` - `"idle"`, `"loading"` (the 3D view's code, ground
    and WebGL are coming) or `"failed"` (the last load failed; the map
    shows);
  - `view3dFailure` - why the last load or the shown view failed
    (`View3dFailure`: `chunk`, `webgl`, `context-lost`, `empty`, `error`),
    or null;
  - the 3D view's shell (`editor-shell/`):
    - `openStations` - the tree's unfolded stations, by id, in the order
      they were unfolded (an id the tour no longer has is ignored by the
      tree);
    - `openSections` - `TreeSection` (`stations`, `codes`, `layers`) to
      open, all open at start;
    - `foldedDocks` - `ShellDock` (`tree`, `inspector`) to folded, none
      at start;
    - `hiddenLayers` - the `ShellLayer`s turned off (`codes`, `names`,
      `walk`, `depth`, `buildings`), none at start;
    - `readout` - the bottom bar's debug readout shows.
- `editorViewActions`:
  - `selected({ id })`;
  - `busyChanged({ busy })`, `doneBusyChanged({ busy })`,
    `pickingChanged({ picking })`, `undeliveredChanged({ waits })`;
  - `moveStarted({ id })`, `moveDropped({ id, drop })`, `moveEnded()`;
  - `walkChanged({ keepsWalk?, openedWalk? })` - each given flag set;
  - `said({ message })` - the card's line, or none;
  - the view switch's (`view-switch.ts` dispatches them):
    `view3dRequested()` (loading; nothing while loading or shown),
    `view3dShown()` (only while loading), `view3dFailed({ reason })` (only
    while loading or shown: back on the map, the reason kept),
    `view2dRequested()` (the map, idle, no reason);
  - the shell's: `stationFolded({ id, open })` (an empty id ignored, no
    id twice), `sectionFolded({ section, open })`,
    `dockFolded({ dock, folded })`, `layerShown({ layer, shown })` (each
    ignoring a key it does not know), `readoutShown({ shown })`.
- `editorViewReducer`, `selectEditorView(root)`.
- `View3dFailure` - the reasons the 3D view did not show.
- `EditorMessage` - the card line's shape (`MapSpot` and `EditorMoving`, the drag's, are module-private).

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
- **The view switch's fields stay consistent:** `viewMode` is `"3d"`
  only with `view3dLoad` `"idle"`, a failure only with the map, and no
  view action touches `selected` or the tour: switching keeps both. A
  late answer (`view3dShown` when no load runs) changes nothing.
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
flag set on its own, and `selected` keeping the line; the view switch's
fields through each action, and late or doubled actions ignored; the
shell's folds, layers and readout, with unknown keys and empty ids
ignored; the slice mounted
beside the shared ones by `createTourViewerStore`, a colliding key
refused, and the phone's store without it.
`editor-view.property.test.ts`: any run of the view actions keeps the
fields consistent and never changes the selection. The page's use of it is
covered by `playwright-tests/editor.spec.js` (the 2D editor's walks:
selection, drag, Done, the picker, the walk) and
`playwright-tests/editor3d.spec.js` (the switch into 3D and back).
