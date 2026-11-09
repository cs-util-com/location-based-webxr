# station-move-question.ts

## Purpose

The question the 3D editor asks (through `confirmPausingFrames`) before a
station's item, a story or a story's entry moves onto another station:
the move never keeps the item's place in the world, so the question says
where it will stand and that it must be placed again.

## Public API

- `stationMoveQuestion(subject, station)` -> the question:
  - `subject` - `{ kind: "story" | "item", name }`;
  - `station` - the target station's title;
  - an item: it will stand at the centre of that station, place it again;
  - a story: its entries keep their places around the station's centre,
    so they stand around the new station, place them again;
  - every question ends "You can undo this.".

## Invariants & assumptions

- Pure: no page, no store. A blank name or title is said plainly ("this
  item", "this story", "the other station"), never as empty quotes.
- The words follow the move rule (`station-children-moves.ts`,
  `movedToStation`): a free item or an entry is reset to the station's
  centre, a story moves whole with its entries' offsets kept.

## Examples

```ts
if (!confirmPausingFrames(stationMoveQuestion({ kind: "item", name }, title)))
  return false;
```

## Tests

`station-move-question.test.ts`: an item's and a story's words, and a blank
name and title. End to end: `playwright-tests/editor3d-child-moves.spec.js`
(the dialog on a drag onto another station, answered yes and no).
