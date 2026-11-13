# shell-inspector.ts

## Purpose

The 3D view's inspector dock drawn from its model (`inspector-model.ts`):
the selection's icon and name, what it is, its commands and its fields
to type, the exact position folded away under a disclosure. What a typed
value writes is `inspector-edits.ts`'s, and the shell commits it.

## Public API

- `drawInspector(dock, model, { folded, positionOpen, contentsOpen?, busy? }, pictures, panel?)` -
  `dock` is `{ root, head, body }` (`#shell-inspector`,
  `#inspector-head`, `#inspector-body`); a null model hides the dock.
  Drawn again only when the model or the state changed (the last draw's
  inputs are remembered per dock), so a store change that is not the
  inspector's - an autosave's status - leaves its controls alone. The
  ground under the selection (`groundOffM`, a station's `offGround`)
  loads and refines while the view shows and the shell draws 5 times a
  second, so a change of only those updates "Put on the ground" and "Put
  items on the ground" in place (their note and off state; a locked
  station's and a running one's left as drawn) and rebuilds nothing. When it
  is drawn again, the control that had the focus (by its `data-act` or
  `data-field`) has it again, with its selection and any text typed and not
  yet committed (a selection left behind would put the next key before the
  old text instead of over it); a slider keeps the focus and carries
  nothing (it has no caret); a control drawn disabled leaves the focus where
  it fell. A call made
  while a draw of the same dock runs (from a `focusout` the draw itself
  caused) is not run: the draw in progress finishes alone. The shell
  draws a null model when it is hidden, before it lets the pictures go.
- `inspectorDrawing(root)` - true while the dock at `root` is being
  drawn: the shell's focusout handler commits nothing then, because
  Chromium fires `focusout` on the focused field a draw removes, in the
  middle of the draw, and the draw carries the typed text over.
- `controlName(root, target)` - the name `target` is drawn under in the
  dock (an attribute selector by its `data-act` or `data-field`), null
  for anything else or outside `root`. `focusControl(root, name,
tabbed)` puts the focus on the control drawn under `name` (none, a
  disabled one or a null name leaves it) and, with `tabbed`, selects a
  one-line field's text, as Tab does in a field no draw replaced. The shell uses the two for the control the
  focus was moving to when a commit drew the dock again: Chromium drops
  a focus whose target a draw removed during `focusout` to the page.
  - Every head starts with "Back to the list" (`data-act="back"`), shown
    only on a phone (`editor-shell.css`), which drops the selection.
  - The head's icon (`headLook`, one case per kind of selection, none
    by default): a block's is its kind's look in the editor's list of
    kinds (`../../kinds/edit-kinds.ts`), and so are the words of its
    Delete (`kindNoun`). A story block's advance chips are worded by
    `ADVANCE_WORDS`, keyed by the format's advance modes.
  - A station: its name as text in the head (`span.ttl`); "Station n
    of N"; its commands; then, first in its section, its **Name** to type
    (`input.tfield`, `data-field="title"`, its label "Name", the
    placeholder "Station n") and its **Description** to type, prose in a
    text area (`textarea.tfield`, `rows` 3: three lines high to start
    with, growing with its text up to twelve lines by `field-sizing:
content` (Chromium, the editor's browser; elsewhere it stays three
    lines and scrolls), the placeholder "Optional"). AU-2 (the owner's
    audit of 2026-10-27): the name had been a borderless field doubling as
    the head's title, with no label and its border shown only on hover,
    so it read as a heading; and a one-line description read as a line.
    This departs from the Studio 3 prototype, which types the name in the
    head. Then its Card image as a group of picture buttons
    (`data-act="image:<id>"`, `aria-pressed` on the one shown), or a
    line saying none can be chosen; under "Place" (its folded summary
    `r 25 m  E .. N .. 30 deg`, the radius first) its Radius to type,
    with what it does (and how far out it starts loading), then its
    Anchor east and north from the 3D view's origin and its Heading to
    type (read-only while locked), its height
    read-only, and "Put on the ground" (`data-act="ground"`, off while
    locked or on the ground, its note "x.x m up/down"), with a note
    saying what the metres are from; when items stand outside the circle,
    a `.warn` line under the Place row, shown folded or not (it asks for
    a change), says visitors see them only from inside it; a station whose
    position cannot be read has its Radius and that line in its fields,
    and says so. The radius sits with the position because both say where
    the station is felt; an item's disclosure stays "Position".
  - A plain folder (the chosen design's open "Pivot (from the station
    centre)" section, no disclosure): the folder icon, its name and
    "Folder in <station>, <n> items"; its pivot's Position east and
    north, Height, Heading and Scale (`scale`, "x") to type, in its
    station's frame, with a note that the scale is typed from 0.1 to 10
    times and dragged by a white dot from 0.2 to 5; "Pivot to centre"
    (`pivot-centre`); "Items (each movable alone)" with a `goto:<id>`
    row per item (or "No items in it yet."); "Select its items"
    (`select-items`, disabled for an empty folder) and a note on how its
    items move with it. Its items follow every typed field.
  - A story: its name to type in the head (`data-field="story-title"`, its
    count under it), its "Entries" fold ("<n>, played in order"), a numbered
    `.kids` row each, `goto:<id>`), "Add entry..." (`add-entry`) and
    "Delete story" (with an entry count and "..." when it holds any).
  - A story's block: its texts and, unless a character's, "Moves on" chips
    (`entry-advance:<id>:tap`, `:auto`; `:lineEnd` shown only while it is
    the block's), "After" in seconds (`data-field="entry-after:<id>"`) while
    by itself; then "Delete entry". For a character a section
    (`div.isec.character`, `data-block` his id) under his name: "View"
    chips (`data-act="character-view:<id>:<view>"`), "Moves on" chips
    (`character-advance:<id>:tap` "On a tap", `:lineEnd` "When the line
    ends"), each group a `role=group` named by its label and the one in
    use pressed, as a model's view chips are (`chipGroup`, which both
    use); a note when his view or his step's advance is none the chips
    offer (an older tour's view, `auto`); and, in the pop-up view only (the
    one view that keeps the creator's facing; a flat figure faces the
    visitor fully), "Facing" in degrees
    (`data-field="character-facing:<id>"`, whole degrees, 360 shown as
    0), then his texts. Every other story block with texts to type gets
    a section of its own (`div.isec.story-text`, `data-block` its id)
    under "<kind> - <name>". Each story block's section (a character's
    too) is a `role=group` named by its head, and each of its text
    fields by its own label only ("Title"): a screen reader says the
    group's name once on entering it, so two blocks' "Title" fields are
    told apart by their group without the head said again per field. A story block's text field is named
    `block:<id>:<field>` and drawn as an item's other texts are
    (`blockTextField`, its count under it; a number field, a sound's radius, reach or volume, is a decimal box with its unit and no count). Where these controls sit is this build's choice, made before the
    owner's prototype round on the editor's character UI.
  - A story's choice or quiz: its summary (`ul.steplines`), read here and
    not edited, and "Delete choice" / "Delete quiz".
  - An item with no place in the world (a video, its `offset` null): its
    texts, its kind panel's parts and its Delete; no split, no ground, no
    Position.
  - An item standing in the world (a pin, a picture, a model, a long
    text, a sound, a free character): what it is and its station (a
    pin's text to type in the head, "Pin text"), its commands, the size
    its white dots change to type (a model's Size, a picture's Width,
    `data-field` `size`, with what it means and its bounds), and under
    "Position" its Offset east and north, Height
    (up from the anchor) and, only where its placement row `turns`, Heading
    to type, in its station's frame (its folders composed in). A thing
    that faces the visitor (a pin, a reading sign, a sound) has no Heading.
  - Typed fields carry `data-field` (`title`, `description`,
    `radius`, `east`, `north`, `height`, `heading`, `size`) and the
    tour's value as `defaultValue`: the shell commits a field whose text
    differs from it. The description is a `<textarea>`, which keeps line
    breaks (its default has the line ends as a text area reads them, one
    character each, so an untouched one reads as untyped); the rest are
    `<input>`s, which drop them: a value with a line break is shown, and
    taken as the default, on one line, so a field left untouched writes
    nothing. A station's name of several lines (from another writer)
    stays editable that way, and a changed one is one line. A pin's text
    of several lines (the 2D card's text area writes them) is read-only
    in the head, since typing would lose its lines, and a line at the
    top of the dock (`#inspector-pin-lines`, which the field is
    described by, also its title) says why: edit it in the pin's card on
    the 2D map. A pin's text typed in the head has its count at the
    top of the dock (`#inspector-pin-count`, an `<output>` the field is
    described by, `pin-text.ts`): "12 / 40", marked `data-over` past
    the 40 characters the edit refuses. A block's other text fields
    (`block-fields.ts`) carry the placeholder "Required" for a field the
    block needs, else "Optional" (`blockFieldPlaceholder`).
  - A code: its line, its print size, and its position, or that none is
    stored.
- Every field's label is tied to its value: a `<label for>` on its
  `<input>` or `<output>` (ids `inspector-field-N`), and a vector's
  parts are a `role="group"` named by its label, each part named
  ("Anchor east", ...).
- The head's buttons and the disclosure carry `data-act` (`fold`,
  `close`, `position`); the shell answers them.
- A station's line ("Station n of N", `.sub`) holds Earlier and Later
  (`data-act` `earlier` / `later`, icon buttons named "Earlier in the
  tour" and "Later in the tour", disabled at the tour's ends): the
  keyboard's way to reorder. A story's and an entry's line holds the same
  pair ("Earlier in the story", "Later in the story", or "among the
  stories" for a story), and the commands add one Move button per target
  of `moves` (`data-act` `move-to:<list>`), and, where `moves.stations`
  is not empty, a "Move to station..." picker (`select[data-move-station]`,
  named "Move to station", its first option disabled) whose choice the
  shell moves to that station's centre, asked first.
- The selection's commands in words (`.acts`, the prototype's): a
  station's "Put items on the ground"
  (`ground-items`, its note "N off", off when none is) and "Delete
  station"; an item's "Move to a new station" (`split`), "Put on the
  ground" (`ground`, its note "x.x m up/down", off when on it), one in a
  plain folder "Select the folder" (`select:folder:<id>`, its note the
  folder's name, in a row of its own) and
  "Delete pin" / "Delete photo" / "Delete long text" / "Delete 3D model". The command `busy`
  names says "Waiting for the ground...", is `aria-disabled` (not
  `disabled`, so it keeps the keyboard's focus) and `aria-busy`. Each
  `.act` is a button with an icon and its words in `.lbl`; Delete is
  `.danger`, shows its key in a `<kbd>` hidden from screen readers and
  announces it by `aria-keyshortcuts="Delete"`. A code has none
  (read-only in the 3D view).
- A kind's own part of an item (`panel`, a `KindPanelDraw` from
  `../kind-panels/kind-panel.ts`), drawn without naming the kind: its
  `title()` in place of the head's own, its `head()` buttons before the
  fold, its `kept` node right under the sub line (a long text's writer,
  which `long-text-dock.ts` owns and the inspector only places, so typing
  never rebuilds it; it stays in the page across draws), and its
  `parts()` after the item's fields, before Position; with `ownsFields`
  the item's fields are not drawn. Its `key` is part of what a draw is
  compared by. A model's view, clip, notes and sections are its
  panel's (`model-panel.ts.md`), a long text's title, Preview and Wider
  its (`long-text-panel.ts.md`); without its panel an item shows none of
  them.

- A station's Contents (`.contents`, `data-act="contents"`, open unless
  `contentsOpen` is false): its items (`inspector-contents.ts`) and Add
  content (`data-act="add-content"`). Its radius has a slider beside the
  number (`radius-slider.ts`).

## Invariants & assumptions

- Its small pieces (`el`, `typed`, `numberField`, `chipGroup`, ...) are
  `inspector-fields.ts`'s, shared with the kinds' panels.

- Nothing here writes: the shell reads the typed fields and the
  commands' `data-act`. A code stays read-only (`<output>`s).
- Text, never markup. Numbers are fixed to the decimals shown, "-0"
  shown as 0; a heading the file does not give shows as "-".
- A station's Place row (`.posrow`) holds its disclosure and the lock button (`data-act="lock"`, `aria-pressed` true while locked, labelled to unlock or to lock). Items have no lock. A station without a position has no lock and no row: its "no position" note stands alone (a lock with nothing to keep still read as if it locked the note).

## Examples

```ts
drawInspector(dock, buildInspector(input), { folded, positionOpen }, pictures);
```

## Tests

`shell-inspector.test.ts` (jsdom, from store states through
`buildInspector`): hidden without a selection, a station's fields each
tied to its label with the position folded, the position in metres of
the tour's centre once unfolded, an item's offset in its station's
frame, a code without a position, and the folded head. The page by
`playwright-tests/editor3d-shell.spec.js` and
`playwright-tests/editor3d-inspector.spec.js` (the edits, saved and
opened again, and the fields' layout at four window sizes).

`shell-inspector.test.ts` also covers a plain folder's pivot fields in
their order, its item rows and its two commands (off for an empty folder), the ground changing under a drawn station (only its ground button updated, the typed field and its focus kept), the lock button's place, state and words, and its absence for a station without a position; Earlier and Later beside a station's place, off at the ends; and the commands in words per kind (a station's Delete with its key, an item's two, none for a code).

It also covers a story (its name, its numbered Entries, its Add entry and
its Delete, an empty one), a choice's and a quiz's summary, an item with
no place in the world (its texts and Delete only), a
story block's moves-on chips and seconds, a story
character's view and advance chips (the one in use pressed, each group
named) and his facing in the pop-up view alone, none for a long text, a story block's texts
named `block:<id>:<field>` (a character's in his box, none for a
block without texts), the fields to type
per kind (each counted in its unit), a locked station's place
and heading read-only with its Put on the ground off, a pin's text in
the head with its count as it is typed (none for a read-only one or a
station's name, which is typed in its labelled Name field in the body,
the head showing it as text; the description three rows high), the outside-the-circle warning, and a command waiting for the
ground (not `disabled`), with the focus kept on it as it starts waiting.
It also keeps the focus on Earlier through an autosave's status change,
and gives the focus back to the control that had it when the inspector
is drawn again; a draw asked for inside a draw is not run, and
`inspectorDrawing` is true only during one; a pin text of several lines
shows on one line, read-only, its reason a line in the dock; a station's
name and description of several lines stay editable, the description a
text area holding its lines.

## The file row

After the moves, a model with `file` draws its "File" row
(`inspector-file.ts` `fileFieldPart`): the name and "Replace...", the row
a drop target for the item's file (`data-filefield`).
