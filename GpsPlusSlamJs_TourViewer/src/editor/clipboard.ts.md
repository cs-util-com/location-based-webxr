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
  names (`selectedStationOf`: a selected station, or the station holding
  the selected row). A row inside a copied folder (a note or a folder at
  any depth) goes with that folder, not again on its own. Refused with
  `NOTHING_COPIED` (empty clipboard), `SELECT_A_TARGET` (no station
  named), `COPIED_GONE` (anything copied no longer in the tour, or no
  longer copyable, such as a note moved into a story).
- `CopyOutcome`, `PasteOutcome` (its folders by `{ stationId, folderId }`), and the five reason
  strings above.

## Invariants & assumptions

- Pure: reads the document and the view state, writes nothing.
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
no target, something gone), and rows inside a copied folder dropped.
The wiring is covered by `editor-shell/editor-shell.test.ts` (the Edit
menu's states) and `playwright-tests/editor3d-clipboard.spec.js`.
