# editor-shell.ts

## Purpose

The 3D view's studio shell, read-only: the top bar's studio controls
(Details, Undo, Redo, Help), the Edit menu's Undo and Redo (where those
fold at a phone's width), the View menu's Top view and Frame, the tree
dock at the left, the inspector dock at the right, the compass and the
zoom buttons at the bottom right, and the bottom bar's 3D parts (the view
line, a hint naming the selection's handles (`inspectorHint`), the debug
readout behind its toggle). The page's own controls (the File menu, the
view switch, Show debug data, the save status and the unsaved mark) stay
the page's and keep their logic; the shell's stylesheet
(`editor-shell.css`) dresses the menus in both views and the rest while
the 3D view shows.

## Public API

- `createEditorShell(deps)` -> `EditorShell`, made once by `edit-main.ts`:
  - `deps.store` (`ShellStore`: `getState()` with `tourDocument` and
    `editorView`, `subscribe`, `dispatch`);
  - `deps.select(id)` - the page's selection (the map follows it);
  - `deps.step("undo" | "redo")` - one step of the edit history;
  - `deps.openDetails()` - the tour's details dialog;
  - `deps.codes()` - the open tour's codes (`InspectorCode[]`);
  - `deps.loadPicture(path)` - a picture's bytes from the open tour;
  - `deps.dialogOpen()` - a page dialog shows (the keys stay out of it).
- `EditorShell.show(view)` - the 3D view shows: the shell draws from the
  store, applies the dock rule's `opened`, follows the store, the window's
  size and the keys, and reads the camera every 200 ms (`READOUT_MS`).
- `EditorShell.hide()` - stops all of that and lets the pictures go
  (each draw also sweeps the cards a redraw replaced).
- `ShellView` - the 3D view's commands it drives (`flyTo`, `frame`,
  `setTop`, `zoom`, `northUp`, `readout`, `setLayers`); a type only, so
  the page's code never holds the 3D view's.

## Invariants & assumptions

- **One copy:** the tree, the inspector, the folds, the layers and the
  readout's toggle are drawn from the store (`editorView`, `tourDocument`
  via `manifestToWrite`); a click dispatches, it never draws by itself. A
  draw runs only when the document, the view state or the position
  disclosure changed.
- **The tree's click rule** (`tree-click.ts`): `treeClick` with the
  event's `timeStamp` and `detail`, then `treeClickPlan`: select, unfold
  or fold, open the codes, fly. A card's fold arrow folds without
  selecting; a section's header folds its section. On a folded dock the
  "Stations" header in its head only unfolds the dock, its sections as
  they were (a tap there used to unfold the dock and close the stations
  in one go, so the tree seemed to collapse).
- **The dock rule** (`dock-rule.ts`): `opened` on show, `selected` when
  the selection becomes another, `resized` on a window resize,
  `tree-unfolded` and `inspector-unfolded` when the creator unfolds one.
- **Layers:** only the codes and the station names are offered (the
  others have nothing drawn yet); hiding the codes deselects a selected
  code.
- **Keys** while the view shows, outside fields and dialogs and without
  Ctrl, Cmd or Alt: T toggles Top view, F frames the selection (or the
  tour), Home frames the tour - none of them while a handle of the gizmo
  is dragged (`pointerDragRuns`: the camera stands still until the
  release; a key hold does not count). Esc closes the help first (a
  capture listener, ahead of the page's Esc, which deselects).
- **Read-only:** nothing here edits the tour; Undo and Redo are the
  page's steps, with their titles from `nextStep`.
- **Text, never markup:** names and lines from the tour are set as text
  (`shell-tree.ts`, `shell-inspector.ts`).
- **The stylesheet** (`editor-shell.css`, applied under
  `body[data-view="3d"]`, the menus' dress in both views): a 40 px top bar
  and a 24 px bottom bar with the view between them; the tree 272 px and
  the inspector 290 px wide, flush with the window's edges, the inspector
  ending 150 px above the view's foot so the compass and the zoom buttons
  at the bottom right stay clear of it at every width; the scene's credits
  at the bottom left. The save status leads the bottom bar, cut short with
  an ellipsis (its words stay its text and its title). Every top-bar
  control keeps its words at every width; the tour's name keeps a floor
  (`--s-name-min`, lowered step by step), and the bar folds in steps
  before the name goes under it:
  - at 820 px the unsaved mark keeps its dot (its words are the bottom
    bar's status line, and its title);
  - at 820 px too the docks shrink to 56 % and 60 % of the width where
    that is less, and the hint goes; a folded tree's head ends where the
    inspector begins (156 px at 390), so the inspector never covers its
    fold arrow;
  - at 720 px Details goes (File's Tour details… and the tour's name open
    the same dialog) and the buttons drop their icons, keeping words;
  - at 520 px Undo and Redo fold into the Edit menu;
  - at 400 px the menus' carets go and the groups close up.
  - Each step starts where the bar, in its most crowded state (the unsaved
    mark shown) in a wide platform face (Verdana, with DejaVu Sans'
    metrics), would no longer hold every control with the name at its
    floor; measured, every state fits from 320 px up.
- The inspector's lock (`data-act="lock"`) toggles the selected station's lock in `editorView` (`stationLocked`); both inspector builds pass `unlockedStations`.

## Examples

```ts
const shell = createEditorShell({
  store,
  select,
  step: runStep,
  openDetails,
  codes: shellCodes,
  loadPicture: readContent,
  dialogOpen,
});
// the view switch's onShown:
if (on && shown3d !== null) shell.show(shown3d);
else shell.hide();
```

## Tests

The rules it applies are unit-tested in their own files
(`tree-click.test.ts`, `tree-model.test.ts`,
`tree-model.property.test.ts`, `inspector-model.test.ts`,
`dock-rule.test.ts`), and its drawing parts under jsdom
(`shell-tree.test.ts`, `shell-inspector.test.ts`,
`shell-pictures.test.ts`, `shell-icons.test.ts`). The page is covered
by `playwright-tests/editor3d-shell.spec.js`: the layout at 390x844,
844x390, 820x1180 and 1440x900 (bars, docks, the map controls at the
bottom right and under the inspector, every top-bar control inside the
bar, in words, and none over another, the name over its floor), the most
crowded bar at each step's edges, the menus from the keyboard, Edit by
touch at a phone's width, the unsaved mark beside File, the tree from the keyboard
alone (Tab order: the top bar left to right, then the tree), a card's click selecting,
unfolding and flying, a double click not toggling, a later click
deselecting and folding, the folds and a layer kept across a trip to the
map, Top view from View and by T, the zoom steps and the debug readout,
and on a phone the folded tree's "Stations" header unfolding the dock
with its stations shown.

The lock's click in the page: `editor3d-edit.spec.js`.
