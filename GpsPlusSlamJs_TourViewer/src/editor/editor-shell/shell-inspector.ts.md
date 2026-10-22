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
    under "Position" its latitude, longitude, height and heading.
  - An item: what it is and its station, a model's size, and under
    "Position" its offset (north, up, east) and heading in its station's
    frame.
  - A code: its line, its print size, and its position, or that none is
    stored.
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

No unit test (no DOM in the unit runner); its model is unit-tested
(`inspector-model.test.ts`) and the drawing by
`playwright-tests/editor3d-shell.spec.js`.
