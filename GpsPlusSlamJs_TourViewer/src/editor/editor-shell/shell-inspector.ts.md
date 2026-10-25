# shell-inspector.ts

## Purpose

The 3D view's inspector dock drawn from its model (`inspector-model.ts`):
the selection's icon and name, what it is, its commands and its fields
to type, the exact position folded away under a disclosure. What a typed
value writes is `inspector-edits.ts`'s, and the shell commits it.

## Public API

- `drawInspector(dock, model, { folded, positionOpen, busy? }, pictures)` -
  `dock` is `{ root, head, body }` (`#shell-inspector`,
  `#inspector-head`, `#inspector-body`); a null model hides the dock.
  Drawn again only when the model or the state changed (the last draw's
  inputs are remembered per dock), so a store change that is not the
  inspector's - an autosave's status - leaves its controls alone. When it
  is drawn again, the control that had the focus (by its `data-act` or
  `data-field`) has it again, with any text typed and not yet committed;
  a control drawn disabled leaves the focus where it fell. The shell
  draws a null model when it is hidden, before it lets the pictures go.
  - A station: its name to type in the head (`input.ttlin`,
    `data-field="title"`, "Station name", the placeholder "Station n");
    "Station n of N"; its commands; its Description to type
    (`input.tfield`); its Card image as a group of picture buttons
    (`data-act="image:<id>"`, `aria-pressed` on the one shown), or a
    line saying none can be chosen; its Radius to type, with what it does
    (and how far out it starts loading) and, when items stand outside the
    circle, a `.warn` line saying visitors see them only from inside it;
    under "Position" its Anchor east and north from the 3D view's origin
    and its Heading to type (read-only while locked), its height
    read-only, and "Put on the ground" (`data-act="ground"`, off while
    locked or on the ground, its note "x.x m up/down"), with a note
    saying what the metres are from; a station whose position cannot be
    read says so.
  - An item: what it is and its station (a pin's text to type in the
    head, "Pin text"), its commands, a model's Size to type, and under
    "Position" its Offset east and north, Height (up from the anchor)
    and Heading to type, in its station's frame.
  - Typed fields are `<input>`s carrying `data-field` (`title`,
    `description`, `radius`, `east`, `north`, `height`, `heading`,
    `size`) and the tour's value as `defaultValue`: the shell commits a
    field whose text differs from it.
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
  keyboard's way to reorder.
- The selection's commands in words (`.acts`, the prototype's): a
  station's "Add pin" (`add-pin`), "Put items on the ground"
  (`ground-items`, its note "N off", off when none is) and "Delete
  station"; an item's "Move to a new station" (`split`), "Put on the
  ground" (`ground`, its note "x.x m up/down", off when on it) and
  "Delete pin" / "Delete photo" / "Delete 3D model". The command `busy`
  names says "Waiting for the ground...", is disabled and `aria-busy`. Each
  `.act` is a button with an icon and its words in `.lbl`; Delete is
  `.danger`, shows its key in a `<kbd>` hidden from screen readers and
  announces it by `aria-keyshortcuts="Delete"`. A code has none
  (read-only in the 3D view).

## Invariants & assumptions

- Nothing here writes: the shell reads the typed fields and the
  commands' `data-act`. A code stays read-only (`<output>`s).
- Text, never markup. Numbers are fixed to the decimals shown, "-0"
  shown as 0; a heading the file does not give shows as "-".
- A station's Position row (`.posrow`) holds its disclosure and the lock button (`data-act="lock"`, `aria-pressed` true while locked, labelled to unlock or to lock). Items have no lock. A station without a position has no lock and no row: its "no position" note stands alone (a lock with nothing to keep still read as if it locked the note).

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

`shell-inspector.test.ts` also covers the lock button's place, state and words, and its absence for a station without a position; Earlier and Later beside a station's place, off at the ends; and the commands in words per kind (a station's Delete with its key, an item's two, none for a code).

It also covers the fields to type per kind, a locked station's place
and heading read-only with its Put on the ground off, a pin's text in
the head, the outside-the-circle warning, and a command waiting for the
ground. It also keeps the focus on Earlier through an autosave's status change, and gives the focus back to the control that had it when the inspector is drawn again.
