# editor-view.ts

## Purpose

The desktop editor's page state that is not the tour (`editorView`):
what is selected, whether an open holds the page, the walk's flags,
Done's and the file picker's in-progress states, whether a save waits to
be delivered again, and the 3D view's load. The tour itself is
`tourDocument`'s (`../tour-document.ts`); this slice is what the page's
chrome reads, one copy for every view of the page.

## Public API

- `EditorViewState`, `initialEditorViewState` - the fields:
  - `selected` - the selected item's id (the model's, `station:<id>` for
    a station), or null;
  - `busy` - an open (or another long step) holds the page's controls;
  - `keepsWalk` - the tour was opened to be saved in place: its saves keep
    the walk, even after a refusal turned them into downloads;
  - `openedWalk` - the opened file carries a walk, none of it moved out
    since (a save leaving it out offers "Save the debug data");
  - `doneBusy` - Done is saving before it opens its dialog;
  - `undelivered` - a save the browser did not deliver waits (the save
    itself, with its zip, stays the page's: Blobs are never state);
  - `picking` - the browser's file picker is open;
  - `entryStep` - `"opening"` or `"adding-scan"` while a tour given
    with a scan opens and then gets its scan (`editor-entry.ts`), null
    otherwise; one busy state to the person across both halves.
    `isEntryIdle(view)` - no open running (`busy`) and no entry between
    its steps (`entryStep`): what every entry of the start card (its
    pickers, its drop, its link, "Open the editor") asks before it
    starts, and what keeps those controls off meanwhile, since `busy`
    alone is false between the open and the add;
  - `duplicating` - a Duplicate or a Paste is reading its pictures
    before it writes: another one does nothing meanwhile (a second
    Ctrl+D or Ctrl+V makes no copy);
  - `clipboard` - what the editor's Copy copied (`{ mode: "copy", ids }`:
    selection ids of notes and plain folders, in the order picked) or
    Cut cut (`{ mode: "cut", ids }`: stations, or station items), or
    null; emptied on an open or a close. It is store state, not
    transient UI: the Edit menu, the keys and the page all read it.
    It holds ids, never copies, so a paste reads the tour as it is then
    (`clipboard.ts` refuses what is gone); the system clipboard is not
    used, so it lives as long as the page;
  - `view3dShown` - the 3D view shows;
  - `view3dLoad` - `"idle"`, `"loading"` (the 3D view's code, ground
    and WebGL are coming) or `"failed"` (the last load failed; the page
    that says so shows, `view3d-failed-page.ts`);
  - `view3dFailure` - why the last load or the shown view failed
    (`View3dFailure`: `chunk`, `webgl`, `context-lost`, `error`), or
    null;
  - `gesture` - `{ id, handle }`: the 3D view's edit under way - a drag
    of a gizmo handle (`move`, `turn`, `dot`) or a held key (`key`) on
    the selection `id` - or null; emptied when a tour is opened or
    closed. The page holds the autosave while one runs (`editing()`);
  - the 3D view's shell (`editor-shell/`):
    - `openStations` - the tree's unfolded stations, by id, in the order
      they were unfolded (an id the tour no longer has is ignored by the
      tree); emptied when a tour is opened or closed
      (`tourDocumentActions.opened` / `closed`), so another tour's
      station of the same id does not open unfolded;
    - `openStories` - the tree's unfolded stories, by id, in the order
      they were unfolded, ignored and emptied as `openStations` are;
    - `openSections` - `TreeSection` (`stations`, `codes`, `layers`) to
      open, all open at start;
    - `foldedDocks` - `ShellDock` (`tree`, `inspector`) to folded, none
      at start;
    - `hiddenLayers` - the `ShellLayer`s turned off (`codes`, `names`,
      `walk`, `depth`, `buildings`), none at start;
    - `picked` - the tree's picked rows (item ids and `folder:<id>`), for
      Group and Ungroup; `selected` is always the last of them, and a
      plain `selected` empties it;
    - `selectMode` - the tree's Select mode (a tap ticks a row; the phone's
      way to pick several);
    - `foldedFolders` - the plain folders folded in the tree (open by
      default); these three are emptied on an open or a close.
- `editorViewActions`:
  - `selected({ id })`;
  - `busyChanged({ busy })`, `doneBusyChanged({ busy })`,
    `pickingChanged({ picking })`, `entryStepChanged({ step })` (an
    unknown step ignored), `undeliveredChanged({ waits })`,
    `duplicatingChanged({ duplicating })`;
  - `copied({ ids, mode? })` - the clipboard set to `ids` as a copy, or
    as a cut for `mode: "cut"` (repeats and blank or non-text ids
    dropped; an empty list empties it; anything but a list is ignored);
  - `clipboardCleared()` - the clipboard emptied (a cut pasted or
    cancelled, or its source gone);
  - `clipboardPastedInto({ stationId })` - one more paste of the copy on
    the clipboard into that station (`clipboard.pastes`, by station id;
    absent until the first paste, dropped by the next Copy or Cut, which
    sets a new clipboard); nothing for a cut, an empty clipboard or a
    blank or non-text id. `clipboard.ts` shifts a repeated paste by it;
  - `walkChanged({ keepsWalk?, openedWalk? })` - each given flag set;
  - the 3D view's opener's (`view3d-opener.ts` dispatches them):
    `view3dRequested()` (loading; nothing while loading or shown),
    `view3dShown()` (only while loading), `view3dFailed({ reason })` (only
    while loading or shown: not shown, the reason kept),
    `view3dClosed()` (not shown, idle, no reason);
  - the shell's: `storyFolded({ id, open })` keeps `openStories`, the story
    folders unfolded in the tree (folded by default); `stationFolded({ id, open })` (an empty id ignored, no
    id twice), `sectionFolded({ section, open })`,
    `dockFolded({ dock, folded })`, `layerShown({ layer, shown })`,
    `picked({ ids })` (strings only, no empty id, no id twice; the last
    becomes `selected`, an empty list keeps it), `selectModeSet({ on })`,
    `folderFolded({ id, folded })` (each
    ignoring a key it does not know); each of
    them ignores a flag that is not a boolean (`open`, `folded`,
    `shown`);
  - the 3D view's (`editor3d-input.ts` dispatches them):
    `gestureStarted({ id, handle })` (ignored for an empty id or a handle
    it does not know), `gestureEnded()`.
- `GESTURE_HANDLES` (the gesture field's handles: move, turn, dot, key).
- `editorViewReducer`, `selectEditorView(root)`.
- `pointerDragRuns(view)` - whether a handle of the gizmo is being
  dragged (a gesture whose handle is not `key`): the shell's camera keys
  wait for its end.
- `View3dFailure` - the reasons the 3D view did not show.
- `modelFocus` - the selected model's note or section in focus
  (`ModelFocus { part: "note" | "section", index }`), or null; set by
  `modelFocused({ focus })`.
- `modelPick` - the click on the model the inspector waits for
  (`ModelPick`: `note-add`, `section-add`, or `note-place` /
  `section-place` with an index), or null; set by
  `modelPickAsked({ pick })`. The 3D view answers it
  (`editor3d-editing.ts`).
- Both are cleared when the selection changes, and on an open or a close.
  Their reducers ignore input that is no focus or pick.
- `pointPick` - "Pick in 3D" armed for the selected short text: the 3D
  view's next click on the ground or another item sets where it points
  (`editor3d-editing.ts`), Escape disarms it (`edit-main.ts`); set by
  `pointPickAsked({ on })` (a flag, anything else ignored). Cleared like
  `modelPick`, and also when several rows are picked.

## Invariants & assumptions

- **Desktop only.** `edit-main.ts` mounts it through
  `createTourViewerStore(undefined, { editorView })`; the phone's store
  never names it, and a key one of the store's own slices has is refused
  there.
- **Not an edit.** No history, no draft write, no revision: nothing here
  is the tour.
- **Setters, not rules.** Each action changes only the field it names.
- **The 3D view's fields stay consistent:** `view3dShown` only with
  `view3dLoad` `"idle"`, a failure only while not shown, and no view
  action touches `selected` or the tour: a load or a close keeps both. A
  late answer (`view3dShown` when no load runs) changes nothing.
- **Kept out on purpose:** the drag preview and the camera target are
  scene resources; nothing is dispatched per frame. A 3D gesture dispatches its start and its end
  only (`gesture`); its one edit is the tour's.
- The station pose lock (`unlockedStations`, `stationLocked`, `isStationLocked`, `STATION_LOCKED`): every station is locked until the inspector's lock unlocks it; the list holds the unlocked ids, so a station a copy or an add made is locked too. View state only - never saved - and `opened`/`closed` lock every station again. A malformed `stationLocked` payload changes nothing.

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
each flag set on its own; `isEntryIdle` false
while busy or between an entry's steps; the 3D view's
fields through each action, and late or doubled actions ignored; the
shell's folds and layers, with unknown keys, empty ids and
flags that are not booleans ignored; the unfolded stations emptied when
another tour opens or the tour closes; the slice mounted
beside the shared ones by `createTourViewerStore`, a colliding key
refused, and the phone's store without it; the clipboard's order,
de-duplication, emptying (by an empty Copy and by an open or a close),
a malformed payload ignored, and Copy never touching the tour.
`editor-view.property.test.ts`: any run of the view actions keeps the
fields consistent and never changes the selection. The page's use of it is
covered by `playwright-tests/editor.spec.js` (the editor's walks:
selection, Done, the picker, the walk) and
`playwright-tests/editor3d.spec.js` (the 3D view's loads and failures).

`editor-view.test.ts` also covers the lock: locked by default, unlocked and locked again, listed once, a malformed payload ignored, and every station locked again at an open and a close.
