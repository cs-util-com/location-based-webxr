# `entry-drop-view.ts` - draws the open dialog's drop area

## Purpose

Draws the drop area (`entry-drop.ts`) into the dialog's elements from the
store's view: one row per file with its name and chip, a radio where
several tours or several scans came, a Remove button per row, the scan
line, and the ONE action with its question. It holds no state: the page
(`edit-main.ts` `drawEntryDrop`, a store subscription) calls it whenever
the rows, the picks, the busy flag or the open tour changed, and it
reports presses back.

## Public API

- `renderEntryDrop(el, view, on)`:
  - `el: EntryDropElements` - `rows` (the list), `note`, `act`,
    `question`, `go`, `addToOpen` (from `edit.html`);
  - `view: EntryDropView` - `rows`, `picks`, `action` (`planEntryAction`'s),
    `busy` (an open, a read or a fetch runs: every control is disabled);
  - `on: EntryDropHandlers` - `remove(id)`, `pick(id)`.

## Invariants & assumptions

- Rows are rebuilt each call (at most `MAX_ENTRY_FILES`); focus on a
  row's radio or Remove button is put back on the same row's control.
- A row is `li.entry-row[data-kind][data-id]`; its `label.entry-main`
  holds the radio (only when its kind has more than one row), the name
  (full name as a tooltip) and the chip.
- `act` is hidden for no rows; for `unusable` the question shows the
  line and the action is hidden; for `pick` the action is disabled;
  `addToOpen` shows only for a lone scan with a tour open.
- The names are written as text, never as HTML.

## Examples

```ts
renderEntryDrop(
  entryElements,
  { rows, picks, action, busy },
  {
    remove: (id) => store.dispatch(editorViewActions.entryFileRemoved({ id })),
    pick: (id) => store.dispatch(editorViewActions.entryFilePicked({ id })),
  },
);
```

## Tests

Drawn in the page by `playwright-tests/editor.spec.js` (the drop area
tests: rows and chips, the scan line, the action's label, the radio pick,
Remove, the add-to-open button). The plan it draws is unit- and
property-tested in `entry-drop.test.ts` / `entry-drop.property.test.ts`.
