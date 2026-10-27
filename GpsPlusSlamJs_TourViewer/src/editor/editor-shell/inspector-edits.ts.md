# inspector-edits.ts

## Purpose

A value typed or a ground command pressed in the 3D view's inspector, as
the one edit of the tour it writes, pure. The shell (`editor-shell.ts`)
hands the edit to the page (`edit-main.ts`), which writes it through the
editor session as one undo step.

## Public API

- `inspectorEdit({ selected, stations, origin, field, value })` ->
  `InspectorEdit`:
  - `selected` is the page's selection (`station:<id>` or an item's id);
    `stations` the tour's; `origin` the 3D view's centre (null: a
    station's place is not typed).
  - A station's `title`, `description` and `radius`: `{ kind: "station",
stationId, edit }` (a `StationEdit` of `tour-document.ts`). A radius
    lower than its items is allowed: they stay where they are.
  - A pin's `title` (the head's text box): `{ kind: "text", id, text }`.
  - A block's other text field (any of `blockFields(item)`, B2c: a short
    text's `description`, a picture's `title` / `caption` / `alt`, a
    model's `title`): `{ kind: "block", id, field, value }`, its cap
    checked by the session. A field the kind does not have: none.
  - A station's `east` / `north`: `{ kind: "scene", edit: station-pose }`,
    its anchor at the place those metres name from `origin`
    (`placeAtEastNorth`), its height and turn kept.
  - An item's `east` / `north`: an item-pose scene edit, its offset in
    its station's frame ([north, up, east]) with that one axis changed.
  - An item's `height`: `{ kind: "height", id, alt }`, the altitude the
    typed up-offset gives in its station's frame; the shell writes it as
    the item's altitude alone (`groundItems`), its latitude, longitude
    and turn untouched. A pose through the station's frame and back moves
    an item sideways by up to about a micrometre (float32), and for an
    item outside a lowered circle that could read as a move outward and
    re-seat it.
  - A `heading`, of a station or an item: `{ kind: "turn", selection, deg
}`, the short way round from the heading it has now (the page turns it
    as the 3D view's turn does).
  - A model's `size`: a size scene edit.
  - A value equal to the tour's, a field the selection has not, a code,
    or a selection the tour lacks: `{ kind: "none" }`.
  - A number field with no number in it (blank, "ten"): `{ kind:
"invalid", reason }` ("Type a number, like 12.5"). Only a plain decimal
    is a number: a sign, digits, and one decimal point or one comma
    ("3,5" is 3.5). Hex ("0x10"), binary, octal, an exponent ("1e3"),
    "Infinity", a thousands separator beside a decimal point or comma
    ("1,000,5", "1.000,5", "1 000") are no number. One comma is always
    a decimal point, by design: "1,000" is 1, not a thousand (a lone
    thousands separator cannot be told from a decimal comma, and a
    comma typed as a decimal point is the commoner case).
- `groundEdit({ selected, stations, which, groundAt })` -> `GroundEdit |
null`:
  - `which: "ground"` on a station: its anchor at the ground under it, as
    a station-pose scene edit (so the lock holds it); on an item: its
    height at the ground under it (`ground-items` with one item).
  - `which: "ground-items"` on a station: every item off the ground, each
    at the ground under its own place, in one `ground-items` edit.
  - Those within `ON_GROUND_M` (0.05 m) of the ground are left out; with
    nothing left: none.
  - Null while the ground under any of them has not loaded: the shell
    waits (`ground-wait.ts`).

## Invariants & assumptions

- Pure; heights are ellipsoidal, as the file writes them, and `groundAt`
  answers ellipsoidal heights (the 3D view's `groundAt`).
- Nothing here checks the station's lock: the shell types a locked
  station's place into read-only fields only, and the session's
  `moveStation` refuses a locked station's pose anyway.
- A position edit keeps the other axes and the turn exactly; a typed
  value within 1e-9 of the tour's writes nothing, so a field left with
  its own value adds no undo step.

## Examples

```ts
inspectorEdit({
  selected: "station:a",
  stations,
  origin,
  field: "radius",
  value: "3,5",
});
// { kind: "station", stationId: "a", edit: { foundRadiusM: 3.5 } }
groundEdit({
  selected: "station:a",
  stations,
  which: "ground-items",
  groundAt,
});
// { kind: "ground-items", items: [{ id: "pa", alt: 561.18 }] } or null while loading
```

## Tests

`inspector-edits.test.ts`: a station's title, description and radius; a pin's text and no model caption; a typed title written for every kind of block (so no "title" falls through as a field the kind lacks); a station moved to the typed east and north, height and heading kept; the turn to a typed heading; an item's typed offset; a typed height as the altitude alone; a model's size; a value that is no number (hex, exponents, thousands separators among them) and the plain decimals that are, an unchanged one; a selection the tour lacks, a code, an unknown field. `groundEdit`: an item once its ground has loaded, a station's items as one edit, a station's anchor with its turn kept, nothing for what stands on the ground already. End to end:
`playwright-tests/editor3d-inspector.spec.js`. A typed height of items
outside a lowered circle keeping their station and place, through the
reducer: `keeps-home.property.test.ts`.
