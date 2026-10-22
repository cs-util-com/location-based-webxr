# editor-shell.ts

## Purpose

The 3D view's studio shell, read-only: the top bar's studio controls
(pencil, Undo, Redo, Frame, Top view, Help), the tree dock at the left,
the inspector dock at the right, the compass and the zoom buttons at the
bottom left, and the bottom bar (the view line, a hint naming the
selection's handles (`inspectorHint`), the debug readout
behind its toggle). The page's own controls (the view switch, Save, Done,
the save status, Open another tour) stay the page's and keep their logic;
the shell's stylesheet (`editor-shell.css`) only dresses them while the 3D
view shows.

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
  selecting; a section's header folds its section.
- **The dock rule** (`dock-rule.ts`): `opened` on show, `selected` when
  the selection becomes another, `resized` on a window resize,
  `tree-unfolded` and `inspector-unfolded` when the creator unfolds one.
- **Layers:** only the codes and the station names are offered (the
  others have nothing drawn yet); hiding the codes deselects a selected
  code.
- **Keys** while the view shows, outside fields and dialogs and without
  Ctrl, Cmd or Alt: T toggles Top view, F frames the selection (or the
  tour), Home frames the tour. Esc closes the help first (a capture
  listener, ahead of the page's Esc, which deselects).
- **Read-only:** nothing here edits the tour; Undo and Redo are the
  page's steps, with their titles from `nextStep`.
- **Text, never markup:** names and lines from the tour are set as text
  (`shell-tree.ts`, `shell-inspector.ts`).
- **The stylesheet** (`editor-shell.css`, applied under
  `body[data-view="3d"]`): a 40 px top bar and a 24 px bottom bar with the
  view between them; the tree 272 px and the inspector 290 px wide, flush
  with the window's edges. The save status is cut short with an ellipsis
  past 220 px (its words stay its text and its title). The tour's name
  and the status keep a floor (`--s-name-min`, `--s-status-min`), and the
  bar folds in steps before the name goes under it:
  - at 1420 px and below the keep-walk switch is its checkbox (its words
    out of sight, still its name, and its title) and "Add debug data" its
    icon;
  - at 1140 px Undo and Redo lose their words and the key hints go
    ("Open another tour" says "Open");
  - at 940 px every studio button is its icon, the view switch says its
    short word and the gaps narrow;
  - at 820 px the docks shrink to 56 % and 60 % of the width where that
    is less, and the hint goes; a folded tree's head ends where the
    inspector begins (156 px at 390), so the inspector never covers its
    fold arrow;
  - at 720 px the help, the pencil and the mark go (the tour's name opens
    the same details), the save status is a dot (its words stay its name
    and title), and Done and Open are icons;
  - at 440 px Redo goes (Undo stays);
  - at 375 px "Add debug data" goes (the map's panel keeps it).
  - Each step starts where the bar, in its most crowded state (the
    keep-walk switch shown and the longest status) in a wide platform
    face (Verdana, with DejaVu Sans' metrics), would no longer hold every
    control; measured, every state fits from 320 px up.

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
844x390, 820x1180 and 1440x900 (bars, docks, map controls, every top-bar
control inside the bar and none over another, the name over its floor),
the most crowded bar at each step's edges, the tree from the keyboard
alone (Tab order: the top bar left to right, then the tree), a card's click selecting,
unfolding and flying, a double click not toggling, a later click
deselecting and folding, the folds and a layer kept across a trip to the
map, Top view by its button and T, the zoom steps and the debug readout.
