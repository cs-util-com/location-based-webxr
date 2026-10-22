# shell-inspector.ts

## Purpose

The 3D view's inspector dock drawn from its model (`inspector-model.ts`):
the selection's icon and name, what it is, and its fields read-only, the
exact position folded away under a disclosure.

## Public API

- `drawInspector(dock, model, { folded, positionOpen }, pictures)` -
  `dock` is `{ root, head, body }` (`#shell-inspector`,
  `#inspector-head`, `#inspector-body`); a null model hides the dock.
  - A station: "Station n of N", its description, its card picture, its
    radius with what it does (and how far out it starts loading), and
    under "Position" its metres east and north of the tour's centre
    (the 3D view's origin), its height and its heading, with a note
    saying what the metres are from; a station whose position cannot be
    read says so.
  - An item: what it is and its station, a model's size, and under
    "Position" its offset (north, up, east) and heading in its station's
    frame.
  - A code: its line, its print size, and its position, or that none is
    stored.
- Every field's label is tied to its value: a `<label for>` on an
  `<output>` (ids `inspector-field-N`), and a vector's parts are a
  `role="group"` named by its label, each part an `<output>` with its
  own name ("Anchor east", ...). The card picture is an `output.thumb`
  with `role="img"`.
- The head's buttons and the disclosure carry `data-act` (`fold`,
  `close`, `position`); the shell answers them.

## Invariants & assumptions

- Read-only: values are `<output>`s, nothing is an input; editing comes
  with the inspector's actions later.
- Text, never markup. Numbers are fixed to the decimals shown, "-0"
  shown as 0; a heading the file does not give shows as "-".

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
`playwright-tests/editor3d-shell.spec.js`.
