# undo-offer.ts

## Purpose

What a toast's Undo does when it is tapped. The page offers one Undo per
one-step edit (a delete, a file deleted with its uses, "Replace
everywhere"); a tap takes that step back only while it is still the
newest edit of the same tour, and otherwise ends the offer and says why.

## Public API

- `undoTap(mine, at, page): () => void` - the tap handler for a step made
  in the session `mine` at revision `at`.
  - `mine` still open (`page.current() === mine`) and `mine.revision() ===
at`: `page.undo()`.
  - a newer change came (another revision): `page.end()`, then
    `page.say(UNDO_NOT_NEWEST)`.
  - another tour is open: `page.end()` only (nothing to say about a tour
    no longer shown).
- `UNDO_NOT_NEWEST`: "A newer change came after it: undo the newer changes
  first."
- `UndoTapPage`: `current`, `end`, `undo`, `say`.

## Invariants & assumptions

- The tap never undoes a step other than the one offered: the edit stack
  would take back the newer change first, which the toast did not name.
- Pure apart from the calls it makes; no timers, no DOM.

## Example

```ts
const t = toast(said, {
  label: "Undo",
  run: undoTap(editor, editor.revision(), {
    current: () => editor,
    end: endUndo,
    undo: () => runStep("undo"),
    say: (text) => toast(text),
  }),
});
```

## Tests

`undo-offer.test.ts`: the undo while newest; the offer ended and
`UNDO_NOT_NEWEST` said after a newer change; ended in silence once
another tour is open.
