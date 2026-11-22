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
  picked rows (in the order picked), else the one selected, when each is
  a note or a plain folder (`folder:<id>`). Refused with
  `NOTHING_SELECTED` for no selection, and with `ONLY_NOTES_AND_FOLDERS`
  when any row is a station, a story, a story's entry, a code or an id
  the tour does not hold (the lot, not part of it).
- `pasteOf(doc, view): PasteOutcome` - `{ kind: "paste", toStationId,
objects, folders }`: the clipboard's notes and plain folders (by
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
- `CopyOutcome`, `PasteOutcome` (its folders by `{ stationId, folderId }`), and the seven reason
  strings above.

## Invariants & assumptions

- Pure: reads the document and the view state, writes nothing. Each
  call builds its lookups once (the objects by id, each station's folder
  chains), not once per clipboard id.
- A composed scale counts as 1, or as on a limit, within 1e-9 (the
  product rounds), as in the document.
- The clipboard holds selection ids, never copies: every paste re-reads
  the tour, so a note edited after the copy is pasted as it is now, and
  a deleted one refuses the paste rather than resurrecting it.
- A story's entry is never copied here (it belongs to its story);
  stations and stories are not copied yet either.

## Examples

```ts
const copy = copyOf(doc, view); // { kind: "copy", ids: ["n1", "folder:f"] }
store.dispatch(editorViewActions.copied({ ids: copy.ids }));
const plan = pasteOf(doc, { ...view, selected: "station:b" });
// { kind: "paste", toStationId: "b", objects: ["n1"],
//   folders: [{ stationId: "a", folderId: "f" }] }
```

## Tests

`clipboard.test.ts`: Copy of a note, a folder and picked rows in order;
each refusal (nothing selected; a station, story, story's entry, unknown
id or folder, alone and among picked rows); Paste's target from a
selected station and from a selected row, its refusals (empty clipboard,
no target: a story, a story's entry and a code's level id among them;
something gone), rows inside a copied folder dropped, and the scale
refusals into another station (a note in a resized folder, folders that
cancel out, a nested folder past 10 or below 0.1, exactly at 10).
The wiring is covered by `editor-shell/editor-shell.test.ts` (the Edit
menu's states) and `playwright-tests/editor3d-clipboard.spec.js`.
