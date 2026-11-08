# tree-nest-drag.ts

## Purpose

The tree's drag of an item among nested lists: a row dragged by its grip
lands before or after a row of a list that takes it, or into a row that
holds a list (a folder), written as ONE move. The station cards' own
reorder is `tree-drag.ts`; this one moves what is inside a card. The rows'
markup, their lists and the rule of which list takes which item are the
app's: the kit has none of its own.

## Public API

- `createNestDrag({ body, grip, rows, scope, placeOf, intoOf, accepts, move })`
  -> `{ dispose() }`:
  - `grip` - a grip's selector; its row is its nearest `rows` ancestor;
  - `rows` - every row a drag may land at, in the order drawn;
  - `scope` - a drag stays among the rows of its row's nearest `scope`
    ancestor (the Tour Viewer passes a station's card);
  - `placeOf(row)` -> `{ list, id }`, or null for a row that is only a
    folder to drop into (a station's own row);
  - `intoOf(row)` -> the list a drop onto that row goes into, or null;
  - `accepts(from, list)` - whether the item may go into `list`;
  - `move(from, drop)` - writes the move: `drop` is `{ list, slot }` (a
    slot counted in that list before the move) or `{ list, into: true }`
    (at its end);
  - an empty or a missing selector throws `RangeError`.
- `NestPlace`, `NestDrop` - the shapes above.

## Invariants & assumptions

- A drag starts only with the main button on a grip inside `body` whose
  row has a place and a scope; the press is `preventDefault`ed and stopped
  (no scroll, no selection, no press of the row under it).
- At every move the target is the row under the pointer (else the
  nearest) among the scope's rows whose list or folder `accepts` the item;
  over the carried row itself there is none. A row that is both in a list
  that takes the item and a folder that does lands into it in its middle
  half, before or after it outside that; a folder alone lands into it.
- While it moves the carried row is marked `dragging` and the target
  `drop-before`, `drop-after` or `drop-into` (one at a time); every mark
  goes at the end.
- A slot drop that `movedAcross` (`tree-reorder.ts`) answers null for
  (where it was) writes nothing. An into drop is always handed on: only
  the app knows whether its end is where the item already is.
- A redraw mid-drag (any store change) carries the drag on when a row
  with the same list and id is drawn again (marked again), and ends it
  unwritten at the next move or the release when there is none.
- Escape (a capture listener on the window, stopped there) and
  `pointercancel` end the drag with nothing written. Only the pointer
  that started it counts; a touch pointer drags as a mouse does (the
  app's grip carries `touch-action: none`).
- No edge scroll yet: a wheel or a finger scrolls the dock, and the
  target follows at the next move.

## Examples

```ts
createNestDrag({
  body: treeBody,
  grip: "[data-move]",
  rows: ".head, .folder, .kid, .emptyrow",
  scope: ".card[data-station]",
  placeOf: (row) => ...,
  intoOf: (row) => row.dataset["into"] ?? null,
  accepts: (from, to) => from.list === "stories" ? to === "stories" : to !== "stories",
  move: (from, drop) => app.moveChild(from.id, drop),
});
```

## Tests

`tree-nest-drag.test.ts` (jsdom, stubbed row boxes): into a folder, before
and after an entry, out onto the station's row; the marks while moving; a
story only among the stories; never out of its station; nothing for a drop
in place, Escape, a cancelled pointer, a press off the grip or with another
button; a redraw that keeps the item carries on and one that loses it ends
unwritten; selectors refused; nothing after `dispose`. The list maths:
`tree-reorder.test.ts` (`movedAcross`, with a property). End to end (the
Tour Viewer's): `playwright-tests/editor3d-child-moves.spec.js`.
