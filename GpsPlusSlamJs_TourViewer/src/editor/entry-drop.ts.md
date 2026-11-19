# `entry-drop.ts` - the open dialog's drop area and its one action

## Purpose

The editor's open dialog is one drop area: "Drop your files here - a
tour, a scan, or both." Every file given to it (dropped, or chosen with
"Choose files…") becomes one row with a chip saying what it is, and the
rows decide the ONE action the dialog offers. This module is the pure
part: the row and chip types, the chip's words, and `planEntryAction`,
which says what the press will do. Nothing is opened until the action is
pressed. A "scan" is a Recorder recording or a phone's debug data.

## Public API

- `EntryChip` - `{ kind: "tour", title, stations }` (either may be null:
  read only when the file's `tour.json` is small), `{ kind: "scan",
captures }` or `{ kind: "neither", reason }`.
- `EntryRow` - `{ id, name, chip }`; store state (`editor-view.ts`
  `entryFiles`). The `File` stays in the page's side table, keyed by id.
- `isEntryRow(value)` - a defensive check of a row from outside (an id,
  a name, a chip of a known kind with fields of their types).
- `EntryPicks` - `{ tour, scan }`: the row picked where several came.
- `MAX_ENTRY_FILES` (8) - the most rows the area holds.
- `SCAN_NOTE`, `SCAN_ONLY_QUESTION`, `NOTHING_USABLE` - the dialog's
  fixed lines.
- `chipLine(chip)` - "Tour - 'Castle walk', 6 stations", "Tour",
  "Scan - 312 camera captures", "Scan - 1 camera capture", "Scan - no
  camera captures", "Not usable - <reason>".
- `planEntryAction(rows, picks, tourOpen) -> EntryAction`:
  - `empty` - no rows;
  - `unusable { line }` - rows, none a tour or a scan;
  - `pick { what, label }` - several tours (or scans), none picked:
    "Pick one tour above", the action disabled;
  - `open { tour, scan, label }` - "Open the tour", or "Open the tour
    with this scan" with a scan;
  - `new-tour-on-scan { scan, question, label, addToOpen }` - a scan and
    no tour: "This is a scan, not a tour. Start a new tour on it?",
    "Start a new tour on this scan"; `addToOpen` when a tour is open, so
    the dialog may offer "Add it to the open tour instead".

## Invariants & assumptions

- A scan never opens as a tour; a tour is the only one or the picked one;
  a scan joins only the tour it came with or a new one; an unusable row
  is never acted on.
- A pick that names no row of its kind counts as no pick.
- Pure and total over any rows and picks; the page validates rows
  (`isEntryRow`) before they enter the store.
- The scan line (`SCAN_NOTE`) is shown whenever a scan is among the rows:
  a scan is shown while editing, is not part of the tour visitors get,
  and is not saved into the tour file.

## Examples

```ts
const action = planEntryAction(
  view.entryFiles,
  view.entryPicks,
  editor !== null,
);
if (action.kind === "open") openStaged(action.tour, action.scan);
```

## Tests

- `entry-drop.test.ts` - every chip's words, the row check, and each
  action for a tour, a tour with a scan, a scan alone (with and without a
  tour open), two tours or two scans before and after a pick, an
  unusable mix and a stale pick.
- `entry-drop.property.test.ts` - over any rows, picks and open state,
  the entry's rules above hold.
- The flow in the page: `playwright-tests/editor.spec.js` (the drop area
  tests).
