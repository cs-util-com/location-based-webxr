# editor-shell.ts

## Purpose

The 3D view's studio shell: the top bar's studio controls
(Undo, Redo, Help), the Edit menu's Undo and Redo (where those
fold at a phone's width), the View menu's Top view and Frame, the tree
dock at the left, the inspector dock at the right, the compass and the
zoom buttons at the bottom right, the bottom bar's toggles and the
bottom panel they open (`bottom-panel.ts`: the tour's problems from
`tour-problems.ts` on each draw, the edit history, and on the readout's
tick the street map's loading and the view's frame times), and in the help
a line naming the selection's handles (`inspectorHint`). The panel takes
its keys from the shell's key handler (Ctrl+J, Ctrl+Shift+M, Escape inside
it), its Escape going no further. The page's own controls (the File menu, the
view switch, Show debug data, the save status and the unsaved mark) stay
the page's and keep their logic; the shell's stylesheet
(`editor-shell.css`) dresses the menus in both views and the rest while
the 3D view shows.

The tree's head holds a search field (`#tree-search`, the page's, never
redrawn: each letter typed draws the tree again for it, Escape empties it
before the page's Escape drops the selection; emptied too when another
tour opens and by an add in place, so the new item shows) and "Fold every station"
(`#tree-collapse`, hidden while the dock is folded), which folds every
unfolded station. A station the search unfolded (it found items of it)
folds on its arrow all the same: its fold is the search's
(`TreeInput.searchFolded`, cleared with each new search), not the
store's. While a search runs the grips drag nothing (a drop would order
the hidden stations unseen), and a press on one says "Clear the search
to change the order of the stations".

Adding happens where the creator looks. A station row's "+" (and an
empty station's "Add content") opens the tree's type menu
(`tree-add-menu.ts`, made once for every row): a short text or a long
text added to that station through `deps.edits.addItem`, the menu
closed first and the focus back on that station's "+" after the add's
redraw. Ctrl+K - anywhere but in a text area or an editable element
(the long-text writer's Link key) and with no dialog open, the
browser's own Ctrl+K prevented - and the top bar's Add (`#studio-add`,
the way in for a touch screen; at a phone's width the Edit menu's `#edit-add`, which leaves the focus on the Edit button, as its menu closes) open the add palette (`add-palette.ts`): a kind and a place typed in one query, its
place the selected station (or the station of the selected item) when
the query names none, and its New station the head's "+" (a station at
the centre of the view). Escape closes the palette before the help it
was opened over. Both close with the view. The tree's foot
(`#tree-foot`, `edit.html`) says these keys in words; not on a phone,
nor while the dock is folded.

**On a phone the panels dock** (`dock-host.ts`'s phone layout): the 3D
view and one tabbed group below it (upright) or beside it (sideways),
holding all seven panels; the sections below on sheets describe the
phone only while the docking loads, or when it failed to load. Docked,
`shownSheet` is null, the details' back arrow (`showList`) shows the
List tab, and a selection that appears shows Details, except in the
Select mode while the List tab shows (its ticks need the list).

**Undocked on a phone** (700 px wide or less, `phone-sheet.ts`) the docks are sheets
over the foot of the page with the map above them: the list when nothing
is selected, the details over it when something is (unless
its inspector model has no phone details, `detailsOnPhone`: a folder tap
keeps the list, its band and the 3D handles), each with a grip
(drag to resize, down past the floor to dismiss). The share of the page
is one CSS number on the body (`--s-sheet-share`), which the canvas reads
too, so the map ends where the sheet begins and is told of its new size
on release only. The head of the details has a back arrow to the list
(`act` "back", `showList`: the selection goes, the list shows) beside
its close button, and `#studio-list` in the top bar brings a dismissed
list back. An open bottom panel stays at the foot and the sheet stands
on it, taking its share of what is left, so Problems and History still
work; a problem tapped turns the sheet into its details. A sideways
phone wider than 700 px keeps the two docks, and turning one with
something selected unfolds the list the details covered. The on-screen keyboard
(`phone-keyboard.ts`) is `--s-keyboard-h` on the page; at every width a
panel stands on the keyboard, so a focused field can scroll above it.
The watcher is hosted by the 3D view, which holds every panel wherever
it sits (docked, each in a pane of its own).
Docked, the layout is told the keyboard's height on every change and,
when it is docked while a keyboard is up, at once.

The tree's editing (G2 M3b) goes through it: "+" in the tree's head adds a
station at the centre of the view (where the view has none, `centre()`
null, it says to come closer to the ground and adds nothing), the scene's
ground menu one where it
was pressed (the editor kit's `scene-menu.ts`); a card's grip reorders the tour by drag
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
items on the ground, the card's picture, and a story
character's view and advance chips (`characterChipEdit`: his station's
`StationEdit.character`; the chip already pressed writes nothing).

A story is a folder of the tree: its arrow folds it (`storyFolded`), its name
selects it, its "+" and its empty line open the type menu for it, a click
unfolds what holds a row. The inspector's `goto:` reveals the entry's folder,
and a view that cannot fly to a story or an entry flies to its station. Added
to a station, a story's name in the head takes the focus, selected.

## Public API

- `createEditorShell(deps)` -> `EditorShell`, made once by `edit-main.ts`:
  - `deps.store` (`ShellStore`: `getState()` with `tourDocument` and
    `editorView`, `subscribe`, `dispatch`);
  - `deps.select(id)` - the page's selection (the map follows it);
  - `deps.step("undo" | "redo")` - one step of the edit history;
  - `deps.codes()` - the open tour's codes (`InspectorCode[]`);
  - `deps.loadPicture(path)` - a picture's bytes from the open tour;
  - `deps.dialogOpen()` - a page dialog shows (the keys stay out of it);
  - `deps.dock?()` - loads `dock-host.ts` (a dynamic import); absent, the
    panels never dock. At every width, while the view shows, the panels
    dock around it; on `hide()` they undock. Docking and undocking draw
    the inspector and the sheets again (docked, no sheet shows). A fold is the store's (`foldedDocks`) and the docking's
    at once: the list's and the details' folds are carried to the groups
    holding them (`dock-host.ts`'s `fold`, a rail) and back from them
    (`syncFromDock`), each side hearing only the other's changes (the bottom panel's panes
    in sight too: `docked({ shown })`, a toggle's hide is `hidePane`), so
    two panels dragged into one group (one fold for both) never undo
    each other, and the approach fold keeps working. An unfold from a rail
    counts as the creator's for the approach. Docked, the dock rule
    folds no side for the other (the 3D view gives way); only a phone
    turned sideways still unfolds the list. Docked, a selection that
    appears shows Details over Files, and the Details panel says "Select
    a station or an item, in the list or in the view." while nothing is
    selected. The docking gets the browser's storage to keep its layout
    in; a kept layout's folds are taken into the store (`restored()`)
    rather than undone by it. The tour's problem count (`bottom-panel-model.ts`'s
    `problemsBadge`, the Problems toggle's own) is the Problems tab's
    badge, so a folded rail shows it;
  - `deps.onDocked?(docked)` - the panels docked or undocked;
  - `deps.onFilesShown?(shown)` - docked, the Files panel came into sight
    or went (the asset shelf's toggle redraws);
  - a docking that failed to load is said once and not tried again until
    a reload;
  - `deps.stations` (`ShellStationCommands`) - the page's commands:
    `add(place, "centre" | "here")`, `reorder(order)`, `split(itemId)`,
    `duplicate(selection)`, `remove(selection)`;
  - `deps.edits` (`ShellEditCommands`) - the inspector's edits:
    `station(stationId, edit)`, `text(id, text)`, `block(id, field,
value)` (a block's other text field, B2c), `scene(edit)` (a pose
    or a size, as the gestures write it; returns whether it was written,
    false when the page refused it and said why), `groundItems(items)` (heights,
    one step), `addItem(stationId, kind)` (a short text or a long text,
    from the tree's add in place and the palette);
  - `deps.say(text)` - a passing line (the page's toast);
  - `deps.folders` (`FolderCommands`, `../folder-commands.ts`) - Group,
    Ungroup, the drag into or out of a plain folder and its rename, each
    one undo step that says its outcome or its refusal.
- `EditorShell.groundMenu(point, place)` - the 3D view's input asks for
  the ground menu (a right click, a long press): opened at `point` (px on
  the 3D canvas, placed in the view's box: the canvas covers only the
  view between the docks) for `place` (null: no ground loaded there); nothing while the
  view is hidden.
- `EditorShell.show(view, { approach })` - the 3D view shows: the shell
  draws from the store, applies the dock rule's `opened`, follows the
  store, the window's size and the keys, and reads the camera every 200 ms
  (`READOUT_MS`). With `approach: true` (the globe view opens on its
  approach) the tree is folded to its tab for the flight.
- `EditorShell.approachEnded(how)` - the approach's bar went (the page
  calls it from the view's `approach.ended`). After a takeover
  (`"taken"`: a click, a wheel, "+", at any height) the hold ends and the
  tree stays a tab for the creator to open. After a landing the tree folded for the
  flight unfolds, with the `dock-unfold` animation (the class
  `unfolding`, gone at its `animationend`) unless reduced motion asks
  for none. It follows the dock rule as at an open with the tree unfolded
  (a tab where the open inspector has no room; on a phone the list opens,
  as at a start). Once
  per approach, and not at all after the creator folded or unfolded the
  tree during the flight; nothing folds the tree again afterwards (no
  zoom-out rule exists).
- `EditorShell.hide()` - stops all of that and lets the pictures go
  (each draw also sweeps the cards a redraw replaced). Closed mid-approach
  it gives the tree back the fold it had at `show` (folded or not), so the
  next open starts with the tree as the creator left it. The exception is
  a takeover: once it has ended the approach, the tree's fold counts as the
  creator's (they saw the folded tree and kept it), so a later close and
  open keeps that fold and does not restore the one from before the
  approach. Deliberately no flag for it: "stays as you left it" is the
  rule, and after a takeover the folded tree is what they left.
- `EditorShell.docked()` - whether the panels are docked now;
  `EditorShell.reveal(id)` - docked, shows a panel (`dock-layout.ts`'s ids),
  its group unfolded (the store follows); undocked, nothing (the asset
  shelf's toggle reveals the Files panel through it). The shell itself reveals the details when they come into sight, and on
  a NEW selection (one compared with the selection last drawn, so a
  redraw of the same one leaves the creator's tab alone) while the list is
  the tab in front of them: on a phone the list and the details share one
  group, so a pick in the list must bring the details forward. Another
  tab in front (Files) stays: a new pick draws the details behind it. Not
  while their group is folded, and not while the Select mode ticks rows
  in the list.
  `EditorShell.badge(id, badge | null)` - the count on a docked panel's
  tab (the shelf's Files count), kept for when the panels dock.
  `EditorShell.conceal(id, instead?)` - docked, takes a shown panel out of
  sight (`dock-host.ts`'s `conceal`); the shelf's toggle pressed again.
  `EditorShell.filesShown()` - docked, whether the Files panel shows (its
  group shown, it the shown tab); undocked, false.
- `EditorShell.clearSearch()` - empties the tree's search, and draws the tree
  without it where it shows: the page calls it for every station it makes and
  for an item it copies (the search would hide the new one, its name matching
  nothing typed), and adding to a station from the tree or the palette does the
  same.
- `EditorShell.flush()` - writes the typing not yet in the tour (an
  inspector field being typed in, a long text's writer before its
  pause); the page calls it before a save.
- `ShellView` - the 3D view's commands it drives (`flyTo`, `frame`,
  `setTop`, `zoom`, `northUp`, `readout`, `setLayers`, `centre` for "+",
  `turn` for Align to station and a typed heading, `groundAt` and
  `origin` for the inspector); a type only, so the page's code never
  holds the 3D view's.
- `ShellEditCommands.model(itemId, edit)` - a model's own edit, as typed
  (`inspector-edits.ts`) or pressed (its panel, `../kind-panels/model-panel.ts`).
  `ShellEditCommands` is exported for the kinds' panels (`PanelContext.edits`).

- The kinds' own parts of the inspector come from one `createKindPanels`
  (`../kind-panels/kind-panels.ts`): `sync` hands it the inspector's model
  on every draw (every panel follows it; a long text's preview closes with
  its selection) and its answer is drawn by `drawInspector`; a press
  (`data-act`) goes to the selected item's kind's panel first, and one it
  takes draws again and ends there; `flush` writes pending typing before a
  selection change or a save. A long text's panel is its dock
  (`../long-text/long-text-dock.ts`, body through `edits.block(id, "body",
...)`, view through `edits.view`); a model's answers its part buttons,
  the 3D view's wait and focus going to `modelPickAsked` and
  `modelFocused`. The shell's generic field input skips a writer's fields:
  only an input drawn under a field name (`data-field`) is written by
  the shell.
- The inspector's station extras: `contents` folds Contents (kept across
  selections), `add-content` opens the tree's type menu for the station,
  `goto:<id>` selects and flies as a tree row does, and the radius slider
  (`radius-slider.ts`) previews through `view.previewRadius` and is
  cancelled when the selection goes or the shell hides.

- Plain folders in the tree (the chosen tree-first prototype):
  - **Multi-select.** Ctrl (or Cmd) + click on an item's or a folder's row
    adds it to the picked rows or takes it out, Shift + click picks the
    rows from the selection to it in the tree's order; in the Select mode
    (`#tree-select`, its `aria-pressed`) a plain click ticks. On a touch
    screen a long press on such a row (`long-press.ts`, `LONG_PRESS`)
    enters the Select mode with that row ticked, and the click that
    follows the press is swallowed. Each pick selects its last row too
    (the inspector and 3D follow it). In the Select mode a tap on a row
    that takes no tick (a station, a story, a story's entry, a code) ends
    the Select mode and selects that row alone, as the chosen prototype
    does. Ctrl+G with nothing to group says `NOTHING_TO_GROUP`. In the
    Select mode a selection lays
    out no docks and a phone's sheet stays the list (the details dock
    `hidden`), so the details never cover the rows being ticked; Done lays
    them out for the selection.
  - **Group and Ungroup.** Ctrl+G (or the bar's Group) groups the picked
    rows (`groupRows`) into a new folder, unfolds its station, ends the
    Select mode, selects the folder and opens its name field with the
    proposed name; Ctrl+Shift+G (or the bar's Ungroup) ungroups the
    picked folders and picks the items they freed. Neither runs inside a
    field or a dialog. The selection bar (`#tree-selbar`,
    `drawSelectionBar`) shows its count, its buttons and why Group is
    off.
  - **Rename.** The pen, F2 on a selected folder, or a new group opens the
    name field; Enter or leaving it writes the name, Escape keeps the old
    one; the focus returns to the folder's row.
  - **Nested drag.** An item drags into a folder's row or its empty line
    and out of a folder onto the station's items; a folder never drags
    into a folder; a folder or a folder's item dropped where it cannot go
    (a story, another station) shows the drag's "Not possible here"
    (`folderDropRefusal`) and changes nothing.

## Invariants & assumptions

- **One copy:** the tree, the inspector, the folds, the layers and the
  bottom panel's problems and history are drawn from the store (`editorView`, `tourDocument`
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
- **The dock rule** (`dock-rule.ts`, with `SHELL_DOCK_LAYOUT` of
  `phone-sheet.ts`: side by side above 700 px, the list open on a phone): `opened` on show, `selected` when
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
  view's. Inside a toolbar or a radio group, Home is the widget's.
- **Edits are the page's:** the shell writes nothing to the tour; Undo
  and Redo are the page's steps, with their titles from `nextStep`, and
  every tree command is a `deps.stations` call (one step each).
- **Reorder:** the drag writes one `reorder` at the drop
  (`tree-drag.ts`); Earlier and Later move the selected station one place
  (`movedTo` of `tree-reorder.ts`) and keep the focus on the button that
  was pressed, or at an end on the other one; the new place is said in a
  polite live region (`#shell-said`, hidden but read: "Now Station n of
  N").
- **Moves inside a station:** a story's, an entry's or a free item's grip
  (`data-move`) drags it with the editor kit's `createNestDrag`
  (`tree-nest-drag.ts`) among its station's stories, into a story (onto
  its row, or a slot among its entries) or out to the free items (onto
  the card's head). A plain folder's grip (at its station's top) drags it
  among the station's folders: a slot among the free list's rows puts it
  after the folders drawn before that slot, a drop on the card's head
  puts it last; one drop is one `folders.reorder`. A folder inside
  another, into another folder, into a story or to another station is
  not offered. A drop the move rule refuses (`childMayGo`) is not
  offered, nor a story to a free item whose file the tour on disk lacks
  (`freeItemUnsaved`), Escape ends a drag with no write, and one drop is one
  `stations.moveChild`. The drag lands only on the row under the pointer:
  over its own place, a refused row or empty space it marks nothing, its
  ghost (labelled with the row's `.nm` text) shows "Not possible here" and
  the page the not-allowed cursor (`editor-shell.css`: `.nest-ghost`,
  `data-nest-drag`), and a release writes nothing. Over another station's card the drag
  marks that card (`drop-across`) where `movedToStation` lets the item go
  there; a release asks first (`stationMoveQuestion`) and, on yes, moves
  it to that station's centre and flies the view there (`moveToStation`).
  The inspector's "Move to station..." picker (`data-move-station`) is
  the same move for the phone and the keyboard. Earlier and Later of a
  story or an entry step it in its list (`childStepTo`); the
  inspector's Move buttons (`move-to:<list>`) put it into that list,
  keeping the selection and moving the focus to the first Move button
  left, else to Earlier.
- **Delete in the inspector** moves the focus to the row button (`.head > .pick`) of the tree card now in
  the deleted station's place (the one before it, at the end), for an
  item to its station's card, and to the view's box when the tree is
  folded or empty: it never falls to the page. A delete that asks first
  (a station's, a story's) and is answered no leaves the selection as it
  was, and the focus on the Delete that was pressed.
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
- **The accent line** (`#load-line` in `edit.html`, and the approach's
  own `.approach`, `globe-approach-run.ts`): a full-width 3 px line
  (`--s-load-h`) in the accent colour glued under the menu bar, never
  hidden and with no tab. In the globe view the approach's line covers it
  while the tour loads (a dark track filling with the camera's fall, a
  progress bar named "Loading tour") and stays full after; the default 3D
  view shows the same full line. Both docks hang directly from it
  (`--s-dock-top`, no gap), square-cornered at the top, for the view's
  whole life. It takes no pointer.
- **Dialogs and toasts** wear the shell's dark dress in both views
  (`editor-shell.css`, "Dialogs and toasts"): the paper tokens of
  `editor.css` are redefined on `.backdrop` and `#toasts`, and the few
  hardcoded white fields (buttons, the drop zone, inputs, the cover
  choices, the done dialog's host list) get the dark field colour.
- **An editable name says so at rest**: the inspector head's `.ttlin`
  (not read-only) shows a dotted underline and a pen at its right; while
  typing only the field's frame shows.
- **Text, never markup:** names and lines from the tour are set as text
  (`shell-tree.ts`, `shell-inspector.ts`).
- **The stylesheet** (`editor-shell.css`, applied under
  `body[data-view="3d"]`, the menus' dress in both views): a 40 px top bar
  and a 24 px bottom bar with the view between them; the tree 248 px
  (`--s-tree-w`; 210 px from 1100 px down) and
  the inspector 290 px wide (`--s-insp-w`), flush with the window's edges,
  both running down to the bottom bar; the compass and the zoom buttons in
  one row at the view's foot, directly left of the inspector while it
  shows and at the right edge otherwise; the scene's credits small at the
  bottom bar's left (their panel opens upward and wraps its lines, though
  the bar keeps its own parts on one line); the toasts 12 px above the map
  controls' row, never over it; the save status said to a screen reader
  only (`.said`), the bar's other parts after the credits: the
  selection's actions, then the panel's toggles flush at the right edge.
  The bottom panel sits at the view's foot and pushes the view up (the
  view's canvas ends at its top), between the open docks, its height in `--s-panel-h` on the page, which the map
  controls and the toasts stand above; at 700 px or less it takes
  the width, the inspector ending at its top. Every top-bar
  control keeps its words at every width; the tour's name keeps a floor
  (`--s-name-min`, lowered step by step), and the bar folds in steps
  before the name goes under it:
  - at 820 px the unsaved mark keeps its dot (its words are its title,
    and the save status a screen reader hears);
  - from 900 px down to 701 px the docks are 226 px and 268 px wide (a
    phone turned sideways keeps both, with the map between them);
  - at 720 px the buttons drop their icons, keeping words;
  - at 560 px Undo, Redo and Add fold into the Edit menu;
  - at 420 px the menus' carets go and the groups close up.
  - Each step starts where the bar, in its most crowded state (the unsaved
    mark shown) in a wide platform face (Verdana, with DejaVu Sans'
    metrics), would no longer hold every control with the name at its
    floor; measured, every state fits from 320 px up.
- **A typed field commits on leaving it** (blur) **and, a line, on
  Enter** (in the description's text area Enter starts a new line), only
  when its text differs from the tour's (`defaultValue`): one edit, one
  undo step per field. The field is set back to the tour's value before
  the edit is written, so the redraw shows what the tour now holds (a
  value that is no number is said, and the tour's value stays). A text
  the page refuses (over the format's cap; its station, pin text and
  block commands return `TypedEditOutcome`, `"refused"`) is said by the
  page and put back in the field, so the typing is kept to be shortened.
  That text lasts only until the inspector is drawn again: a refusal on
  Enter keeps the focus in the field, and a draw carries focused, typed
  text over; a refusal when the field is left lets the focus go where it
  was going, and the next draw (any store change, an autosave's status
  among them) shows the tour's value. The focus is not pulled back into
  the refused field: when it was left for another selection, the draw for
  that selection would carry the refused text into the new selection's
  field of the same name. Escape in a changed field puts the tour's value back and goes
  no further (the page's Escape would deselect). Text still typed when
  the selection changes or the view hides is committed to the selection
  it was typed for.
- **A draw is not "leaving" a field.** Chromium fires `focusout` on a
  focused field a draw takes out of the page, synchronously, in the
  middle of the draw; the focusout handler commits only while no draw
  runs (`inspectorDrawing`; the tree's folder name field likewise,
  `drawingTree`, so a redraw never writes a half-typed name), and the draw carries the typed text and the
  focus over to the field drawn again. Without that, a draw while typing
  (the readout's tick as the ground loads, a change made elsewhere)
  committed the half-typed text as its own undo step and, through the
  store change, drew the inspector again inside the draw and left it
  stale.
- **Leaving a field keeps the focus moving.** The commit draws the
  inspector at once, inside the `focusout`, which takes the control the
  focus is moving to (`relatedTarget`) out of the page too, and Chromium
  then drops the focus to the page: Tab lost the creator's place, and the
  next plain key was the page's (T toggled the top view). The handler
  finds that control by its name before the commit (`controlName`) and
  focuses the one drawn again under it after (`focusControl`).
- **A typed height is the item's altitude alone** (`groundItems` with one
  item): its place and turn stay bit for bit, so a height never moves an
  item sideways (a pose through the station's frame and back would, by
  its float32 rounding).
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
    addItem,
  },
  say: (text) => toast(text),
});
// the view switch's onShown:
if (on && shown3d !== null) shell.show(shown3d);
else shell.hide();
```

## Tests

- "the tree's plain folders" in `editor-shell.test.ts`: Ctrl+click and
  Ctrl+G make a folder whose name field takes the focus with the proposed
  name, renamed by Enter; a Shift range grouped from the bar, Escape
  keeping the name, Ungroup picking the freed items; the Select mode's
  button and Done, and a touch long press entering it with the press's
  click swallowed; a tap on a station's row ending the Select mode;
  Ctrl+G with nothing picked; the name field's cap, and a redraw while
  typing (its focus loss reported, as Chromium does) keeping the typed
  name, the focus and the caret, nothing written until Enter. In a
  browser: `playwright-tests/editor3d-folders.spec.js` (a folder's drag
  among its station's folders too).

The rules it applies are unit-tested in their own files
(`tree-click.test.ts`, `tree-model.test.ts`,
`tree-model.property.test.ts`, `inspector-model.test.ts`,
`dock-rule.test.ts`), and its drawing parts under jsdom
(`shell-tree.test.ts`, `shell-inspector.test.ts`,
`shell-pictures.test.ts`, `shell-icons.test.ts`). The phone's sheets and
keyboard: `phone-sheet.test.ts`, `phone-keyboard.test.ts`, and
`playwright-tests/editor3d-phone.spec.js` (positions and gaps at 390x844
and 844x390: the tap to details, back and close, the drag and the
dismiss, the bottom panel under a sheet). The page is covered
by `playwright-tests/editor3d-shell.spec.js`: the layout at 390x844,
844x390, 820x1180 and 1440x900 (bars, docks, the map controls at the
bottom right and under the inspector, every top-bar control inside the
bar, in words, and none over another, the name over its floor), the most
crowded bar at each step's edges, the menus from the keyboard, Edit by
touch at a phone's width, the unsaved mark beside File, the tree from the keyboard
alone (Tab order: the top bar left to right, then the tree), a card's click selecting,
unfolding and flying, a double click not toggling, a later click
deselecting and folding, the folds and a layer kept across a trip to the
map, Top view from View and by T, the zoom steps and the Performance
tab's view and draw calls, the bottom panel's toggles and panel at a
phone, a phone in landscape and a desktop (positions and gaps, Ctrl+J),
and on a phone the folded tree's "Stations" header unfolding the dock
with its stations shown.

The shell itself under jsdom, on `edit.html`'s markup and a real store
with the page's commands as spies (`editor-shell.test.ts`): text typed
and not committed goes to the selection it was typed for on a selection
change and on `hide()`; a refused text (a block field, a pin text, a
station name) kept in the field, a written one showing the tour's value;
a story character's chips written as his station's edit, the pressed one
writing nothing;
a draw while typing (a store change, the ground
arriving on the readout's tick) commits nothing and keeps the text and
the focus (Chromium's synchronous `focusout` on a removed field is
reproduced there, jsdom lacks it); the commit's own draw hands the focus
on to the control it was moving to, drawn again; Escape puts the value
back; Enter in the description is a new line and leaving it writes the
lines; a description and a pin text of several lines focused and left
write nothing; a ground command
waiting is called off by a selection change (later ground writes
nothing), and writes once the ground arrives when the selection stays;
the readout's tick builds no tour with nothing selected; the bottom
panel lists the open tour's problems, a row selecting and flying to its
item, its fix link writing the edit (with the view's loaded ground, so a
moved item keeps its height over it) and saying so only when written, Ctrl+J opening it,
the view's map tiles listed and Retry reaching the view, the tick
feeding the Performance tab, and the help's line following the
selection. The panel's history times come from a subscription the shell
keeps for the page's life (each step stamped when first seen, so steps
made on the 2D map are timed too).

The lock's click in the page: `editor3d-edit.spec.js`.

The inspector's editing in the page:
`playwright-tests/editor3d-inspector.spec.js` (a name by Enter, Escape
putting it back, a description of two lines by Tab, the focus then on
the next field (and on the Position button after the radius), a radius under its pin
with the warning, a value that is no number, one undo per field, saved
and opened again; a name typed while a change made elsewhere draws the
inspector again stays one step, with the text kept, and Tab then hands
the focus on; Put items on the ground as one step, a locked
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
`bar-actions.test.ts`, and in the editor kit's `src/chrome/`:
`tree-reorder.test.ts`, `tree-drag.test.ts`,
`scene-menu.test.ts`.

## Narration

`ShellEditCommands.narration` and `.editNarration` reach the session; the dock passes them, with `.voiceMaxBytes` (the page's autosave cap), to the writer's Narration section. A stamp per state of the tour's `timings` (`timingsStampOf`) goes into `buildInspector`, so the section re-reads when a timing changes without the narration record changing.

## An item's file

The inspector's model gets `file` (`inspector-file.ts`) for a block made
from a file, named through `deps.fileNameOf`; its "Replace..."
(`REPLACE_FILE_ACT`) calls `deps.edits.replaceFile(blockId)`, which the
page answers with a picker and the session's `setItemFile`.

## The add menu's Character

`ShellEditCommands.addCharacter({ kind: "station" | "story", id })`: the
shell unfolds the station (or reveals the story), clears the search and
hands the place over. The page then opens the character maker and adds the
character that was made (`edit-main.ts`, `addCharacterTo`). Tested in
`editor-shell.test.ts` ("the add menu's Character").
