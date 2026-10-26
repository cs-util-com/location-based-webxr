# editor-shell.ts

## Purpose

The 3D view's studio shell: the top bar's studio controls
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

The tree's editing (G2 M3b) goes through it: "+" in the tree's head adds a
station at the centre of the view, the scene's ground menu one where it
was pressed (`scene-menu.ts`); a card's grip reorders the tour by drag
(`tree-drag.ts`), the inspector's Earlier and Later by the keyboard; the
inspector's Delete and "Move to a new station"; the bottom bar's power
actions (`bar-actions.ts`: Duplicate, Align to station, Copy position).
Each is a page command (`deps.stations`), one undo step; the shell writes
nothing to the tour itself.

The inspector's editing goes through it too: a value typed in the
inspector (a station's name, description, radius, place and heading; a
pin's text; an item's offset, height and heading; a model's size)
becomes one edit (`inspector-edits.ts`) and one page command
(`deps.edits`), one undo step per field; so do Put on the ground, Put
items on the ground, the card's picture and Add pin.

## Public API

- `createEditorShell(deps)` -> `EditorShell`, made once by `edit-main.ts`:
  - `deps.store` (`ShellStore`: `getState()` with `tourDocument` and
    `editorView`, `subscribe`, `dispatch`);
  - `deps.select(id)` - the page's selection (the map follows it);
  - `deps.step("undo" | "redo")` - one step of the edit history;
  - `deps.openDetails()` - the tour's details dialog;
  - `deps.codes()` - the open tour's codes (`InspectorCode[]`);
  - `deps.loadPicture(path)` - a picture's bytes from the open tour;
  - `deps.dialogOpen()` - a page dialog shows (the keys stay out of it);
  - `deps.stations` (`ShellStationCommands`) - the page's commands:
    `add(place, "centre" | "here")`, `reorder(order)`, `split(itemId)`,
    `duplicate(selection)`, `remove(selection)`;
  - `deps.edits` (`ShellEditCommands`) - the inspector's edits:
    `station(stationId, edit)`, `text(id, text)`, `scene(edit)` (a pose
    or a size, as the gestures write it), `groundItems(items)` (heights,
    one step), `addPin(stationId)`;
  - `deps.say(text)` - a passing line (the page's toast).
- `EditorShell.groundMenu(point, place)` - the 3D view's input asks for
  the ground menu (a right click, a long press): opened at `point` (px in
  the view) for `place` (null: no ground loaded there); nothing while the
  view is hidden.
- `EditorShell.show(view)` - the 3D view shows: the shell draws from the
  store, applies the dock rule's `opened`, follows the store, the window's
  size and the keys, and reads the camera every 200 ms (`READOUT_MS`).
- `EditorShell.hide()` - stops all of that and lets the pictures go
  (each draw also sweeps the cards a redraw replaced).
- `ShellView` - the 3D view's commands it drives (`flyTo`, `frame`,
  `setTop`, `zoom`, `northUp`, `readout`, `setLayers`, `centre` for "+",
  `turn` for Align to station and a typed heading, `groundAt` and
  `origin` for the inspector); a type only, so the page's code never
  holds the 3D view's.

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
- **Keys** while the view shows, outside fields, menus and dialogs and
  without Ctrl, Cmd or Alt (`key-target.ts`): T toggles Top view, F
  frames the selection (or the tour), Home frames the tour - none of them
  while a handle of the gizmo is dragged (`pointerDragRuns`: the camera
  stands still until the release; a key hold does not count). Esc closes
  the help first (a capture listener, ahead of the page's Esc, which
  deselects) - but an open menu is the newer popover: Escape closes it
  first (`closeOpenMenu`, the focus back on its button), whether the focus
  is in it or has left it, and the help on the next Escape, also from a
  menu's button. Every other key in a menu is the menu's, and on a menu's button the
  keys that open or move in it (`key-target.ts`); T and F there are the
  view's.
- **Edits are the page's:** the shell writes nothing to the tour; Undo
  and Redo are the page's steps, with their titles from `nextStep`, and
  every tree command is a `deps.stations` call (one step each).
- **Reorder:** the drag writes one `reorder` at the drop
  (`tree-drag.ts`); Earlier and Later move the selected station one place
  (`movedTo` of `tree-reorder.ts`) and keep the focus on the button that
  was pressed, or at an end on the other one; the new place is said in a
  polite live region (`#shell-said`, hidden but read: "Now Station n of
  N").
- **Delete in the inspector** moves the focus to the tree card now in
  the deleted station's place (the one before it, at the end), for an
  item to its station's card, and to the view's box when the tree is
  folded or empty: it never falls to the page.
- **The view's box** (`#view3d`, `tabindex="-1"`) shows a ring only when
  a key brought the focus there (`:focus-visible`), as the ground menu's
  Escape does.
- **The bar's actions** are drawn from the inspector's model
  (`barActions`) with each draw, `data-bar` naming each, the focus kept
  across a draw. Align to station turns an item by its heading in its
  station's frame (taken as -180 to 180 degrees) through `ShellView.turn`,
  and says it is already aligned within `ALIGNED_DEG` (nothing written);
  "Turned ..." is said only once the tour carries the turn. Copy position
  writes `positionText` to the clipboard and says it, or says the text
  when the clipboard is refused.
- **The ground menu** returns the focus to the view's box (`#view3d`,
  `tabindex="-1"`), where the window's view keys keep working; hiding the
  view closes it.
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
- **A typed field commits on leaving it** (blur) **and on Enter**, only
  when its text differs from the tour's (`defaultValue`): one edit, one
  undo step per field. The field is set back to the tour's value before
  the edit is written, so the redraw shows what the tour now holds (a
  refusal or a value that is no number is said, and the tour's value
  stays). Escape in a changed field puts the tour's value back and goes
  no further (the page's Escape would deselect). Text still typed when
  the selection changes or the view hides is committed to the selection
  it was typed for.
- **A draw is not "leaving" a field.** Chromium fires `focusout` on a
  focused field a draw takes out of the page, synchronously, in the
  middle of the draw; the focusout handler commits only while no draw
  runs (`inspectorDrawing`), and the draw carries the typed text and the
  focus over to the field drawn again. Without that, a draw while typing
  (the readout's tick as the ground loads, a change made elsewhere)
  committed the half-typed text as its own undo step and, through the
  store change, drew the inspector again inside the draw and left it
  stale.
- **A typed height is the item's altitude alone** (`groundItems` with one
  item): its place and turn stay bit for bit, so a height never moves an
  item sideways (a pose through the station's frame and back would, by
  its float32 rounding, and could re-seat an item outside a lowered
  circle).
- With nothing selected the inspector's model is not built (no tour is
  built for it on the readout's tick, five times a second).
- **Put on the ground waits for the ground:** where the ground under
  what it moves has not loaded, the command shows "Waiting for the
  ground..." (`aria-disabled` and `aria-busy`: it keeps the keyboard's
  focus, and a press while it waits does nothing) and reads it again
  (`ground-wait.ts`) until it has, then writes; after 20 s it says the
  ground has not loaded. A selection change or hiding the view calls
  the wait off. What already stands on the ground is said, not written.
  The inspector is drawn again with the camera readout, so the "N off"
  and "x m up" notes follow the ground as it loads (in the tenths of a
  metre they show: `inspector-model.ts` rounds them, so ground that
  changes by centimetres does not draw it again).
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
  stations: {
    add: addStationAt,
    reorder: reorderStations,
    split: splitItem,
    duplicate,
    remove,
  },
  edits: {
    station: editStation,
    text: editText,
    scene: commitSceneEdit,
    groundItems,
    addPin,
  },
  say: (text) => toast(text),
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

The shell itself under jsdom, on `edit.html`'s markup and a real store
with the page's commands as spies (`editor-shell.test.ts`): text typed
and not committed goes to the selection it was typed for on a selection
change and on `hide()`; a draw while typing (a store change, the ground
arriving on the readout's tick) commits nothing and keeps the text and
the focus (Chromium's synchronous `focusout` on a removed field is
reproduced there, jsdom lacks it); Escape puts the value back; a pin text
of several lines focused and left writes nothing; a ground command
waiting is called off by a selection change (later ground writes
nothing), and writes once the ground arrives when the selection stays;
the readout's tick builds no tour with nothing selected.

The lock's click in the page: `editor3d-edit.spec.js`.

The inspector's editing in the page:
`playwright-tests/editor3d-inspector.spec.js` (a name by Enter, Escape
putting it back, a description by leaving it, a radius under its pin
with the warning, a value that is no number, one undo per field, saved
and opened again; a name typed while a change made elsewhere draws the
inspector again stays one step, with the text kept; Put items on the ground as one step, a locked
station's place read-only, Put on the ground and a typed place and
heading once unlocked, Add pin and its text; the fields' layout at the
four sizes). Its parts' own tests: `inspector-edits.test.ts`,
`ground-wait.test.ts`.

The tree's editing in the page: `playwright-tests/editor3d-tree.spec.js`
("+", the drag, Escape during a drag, Earlier and Later with the new
place said, Delete with the focus on the card in its place and the
toast's Undo; a station made here starts unlocked; the grip's 24 px
touch target on a touch screen; New station here; a station with a photo duplicated, saved
and opened again; the "+", the grips and the bar's actions in place at
the four sizes, the Delete's key in dim letters as the prototype has it) and `editor3d-edit.spec.js` (Align to station, Copy
position, Move to a new station). Its parts' own tests:
`tree-reorder.test.ts`, `tree-drag.test.ts`, `bar-actions.test.ts`,
`scene-menu.test.ts`.
