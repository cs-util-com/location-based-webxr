# clipboard.ts

## Purpose

The editor's Copy and Paste as data (pure): what Copy may put on the
editor's clipboard (`EditorViewState.clipboard`, `editor-view.ts`), and
what a Paste of it would do with the selection as it is, or why it
cannot. The Edit menu (`editor-shell/editor-shell.ts`) reads both for its
enabled states and titles; the page (`edit-main.ts`, Ctrl+C, Ctrl+V and
the menu's items) acts on them; the document's `clipboardPasted`
(`tour-document.ts`) writes the paste through the session's `paste`.

## Public API

- `copyOf(doc, view): CopyOutcome` - `{ kind: "copy", ids }`: the tree's
  picked rows (in the order picked), else the one selected, when they are
  all stations (`station:<id>`), all stories (`story:<id>`), or all
  notes and plain folders (`folder:<id>`). Refused with
  `NOTHING_SELECTED` for no selection, with `NOT_COPYABLE` when any row
  is a story's entry, a code or an id the tour does not hold, and with
  `COPY_ONE_KIND` for a mix of the three kinds (the lot, not part of it).
- `pasteOf(doc, view): PasteOutcome` for copied stations - `{ kind:
"pasteStations", afterStationId, stations }`: after the station the
  selection names (`selectedStationOf`: a station, or any row in one), in
  the order copied; for copied stories - `{ kind: "pasteStories",
toStationId, afterStory, stories }`: into that station, after the
  selected story (or the story of a selected entry), else (`afterStory`
  null) after its last story. Both refused `SELECT_A_TARGET` (no station)
  and `COPIED_GONE` (a copied station or story gone since).
- `pasteOf(doc, view): PasteOutcome` for notes and folders - `{ kind: "paste", toStationId,
objects, folders, shiftM }`: the clipboard's notes and plain folders (by
  `{ stationId, folderId }`), each once, into the station the selection
  names (`pasteTargetOf`: a selected station, or the station holding
  the selected note or folder). A row inside a copied folder (a note or
  a folder at any depth) goes with that folder, not again on its own.
  Refused with `NOTHING_COPIED` (empty clipboard), `SELECT_A_TARGET`
  (no station named: nothing selected, a story or a story's entry, which
  what is pasted would not go into, a code, whose selection is its level
  id, or an unknown id), `COPIED_GONE` (anything copied no longer in
  the tour, or no longer copyable, such as a note moved into a story),
  and, into another station only (`crossStationRefusal`),
  `NOTE_IN_RESIZED_FOLDER` (a note its folders resize: out of them it
  would change size; folders that cancel out, 2 x 0.5, do not count)
  and `FOLDER_SCALE_TOO_FAR` (a folder whose own and outer scales
  multiply past the format's 0.1 to 10: pasted alone it takes that
  product as its scale). The document refuses both the same way.
- `pasteScaleRefusal(doc, plan): string | null` - the first of
  `NOTE_IN_RESIZED_FOLDER` / `FOLDER_SCALE_TOO_FAR` that the paste
  `plan` (`toStationId`, `objects`, `folders`) meets in `doc` as it is
  now, or null. The session asks it for a paste the document refused
  after the picture read, so a folder resized during the read is said as
  the resize rather than as a distance.
- `cutOf(doc, view): CutOutcome` - `{ kind: "cut", ids }`: the picked
  rows, or the one selected, when each is a station or each is in one (a
  note, a plain folder, a story by `story:<id>`, a story's entry);
  refused `NOTHING_TO_CUT` (nothing selected, a code, an unknown id) and
  `CUT_ONE_KIND` (stations among their items). The page stores it as
  `copied({ ids, mode: "cut" })`.
- `cutGone(doc, view): boolean` - the clipboard is a cut naming an id the
  tour no longer holds (an edit or an undo removed it): the page empties
  it on its refresh, so a stale cut never moves anything.
- A Paste of a cut (`pasteOf` with `clipboard.mode === "cut"`):
  - its items moved onto the station the selection names (`selectedStationOf`:
    a station, or any row in one): `{ kind: "move", toStationId, moves }`,
    each move `{ id, to: { place: "station", station } }` for the
    session's `moveChildren` (the tree drag's move path, one step);
    items already in the target are left out;
  - its stations put after the selected station: `{ kind: "reorder",
afterStationId, order }` for `reorderStations`;
  - refused `SELECT_A_TARGET` (no station), `COPIED_GONE` (a source gone),
    `FOLDER_STAYS` (a plain folder, or an item in one, to another station:
    the folder actions keep those in their station), `CUT_SAME_STATION`
    (everything is in the target already), `CUT_STATION_TARGET` (a cut
    station selected) and `CUT_STATIONS_IN_PLACE` (nothing would move).
  - refused, too, for a move the document would refuse: each leaving
    item is checked with `childMoveChange` onto the target, and its
    reason said in `MOVE_REFUSALS` words (a choice or quiz entry stays
    in its story, a model without a size cannot stand free). The menu,
    the bar and the key then offer no Paste, rather than one that empties
    the clipboard and moves nothing. Only "unsaved" (a story whose items
    the file does not hold yet) is left to the session, which says it
    with the item's name.
- `MOVE_REFUSALS` - the words for `childMoveChange`'s refusals
  (`missing`, `ownStory`, `noNesting`, `cannotStandFree`), and
  `NO_SUCH_STORY` ("That is no longer in this tour."); the session's
  `moveChild` and `moveChildren` say the same words (it imports them).
- `CopyOutcome`, `CutOutcome`, `PasteOutcome` (its folders by
  `{ stationId, folderId }`), and the reason strings above.

## Invariants & assumptions

- Pure: reads the document and the view state, writes nothing. Each
  call builds its lookups once (the objects by id, each station's folder
  chains), not once per clipboard id.
- A composed scale counts as 1, or as on a limit, within 1e-9 (the
  product rounds), as in the document.
- The clipboard holds selection ids, never copies: every paste re-reads
  the tour, so a note edited after the copy is pasted as it is now, and
  a deleted one refuses the paste rather than resurrecting it.
- A story's entry is never copied on its own (it belongs to its story,
  and goes with it).
- A cut keeps ids: its paste moves the items, so links to them (an
  answer's jump, a code) keep pointing at them.
- Repeated pastes shift only within the same station: `shiftM` is
  `PASTE_REPEAT_STEP_M` (0.5 m, `station-geometry.ts`) times the
  pastes of this clipboard already made into the target station
  (`clipboard.pastes`, counted per station by `editorView`'s
  `clipboardPastedInto` after each paste lands). The first paste into a
  station shifts nothing: into another station the copy keeps the exact
  copied offset, into its own it is Duplicate's copy, 1.5 m east. Each
  further paste of the same clipboard into the same station stands half
  a metre further east (world east, as Duplicate's offset), so copies
  never stack where they cannot be told apart or picked; half a metre
  keeps them apart to the eye and to a tap while a handful still stand
  within the smallest found radius (2 m). A new Copy or Cut starts the
  count again; an undone paste is not uncounted, so the next one still
  stands clear of the copies that remain. A copy the shift would take
  past its station's bound is refused, as any paste beyond it is.
  Stations and stories are not shifted: a station's copies already go
  beside the one before, and a story has no place of its own.

## Examples

```ts
const copy = copyOf(doc, view); // { kind: "copy", ids: ["n1", "folder:f"] }
store.dispatch(editorViewActions.copied({ ids: copy.ids }));
const plan = pasteOf(doc, { ...view, selected: "station:b" });
// { kind: "paste", toStationId: "b", objects: ["n1"],
//   folders: [{ stationId: "a", folderId: "f" }], shiftM: 0 }
```

## Tests

`clipboard.test.ts`: Copy of a note, a folder and picked rows in order;
each refusal (nothing selected; a station, story, story's entry, unknown
id or folder, alone and among picked rows); Paste's target from a
selected station and from a selected row, its refusals (empty clipboard,
no target: a story, a story's entry and a code's level id among them;
something gone), rows inside a copied folder dropped, and the scale
refusals into another station (a note in a resized folder, folders that
cancel out, a nested folder past 10 or below 0.1, exactly at 10), and
the repeated paste's shift (half a metre per earlier paste into the
target station, none for a station not pasted into yet).
Stations and stories: their Copy, a mix of kinds refused, a Paste after
the selected station and into a station after a story or at the end of
its stories, its refusals (no target, a copied station or story gone).
Cut: each refusal of `cutOf`, the cut of stations and of items, the
gone cut, and a cut's Paste (onto another station, a story whole, into
its own station, a folder or an item in one to another station, the
stations reordered, a cut station as the target, a stale id).
The wiring is covered by `editor-shell/editor-shell.test.ts` (the Edit
menu's states) and `playwright-tests/editor3d-clipboard.spec.js`.
