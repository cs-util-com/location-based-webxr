# move-question.ts

## Purpose

What a move asks and says, one pure rule for the desktop, the phone and AR. A
moved item keeps its station unless the creator agrees otherwise: a move into
another station's circle asks whether it should change, a move out of its own
circle says where the item stands now. The tour document does as it is told
(`moved`, `joinStation`); this file only words the question and the note.

## Public API

- `moveQuestion(state, id, geo): MoveQuestion | null`
  - `{ stationId, text, declined }`: the station it could change to, the
    question naming both stations, and what a No means.
  - Null when there is nothing to ask: the spot is in the item's own circle,
    in no other circle, in the circle of a station that already held the
    item where it stood (radii overlap, an earlier No), or the id is unknown.
    A lift or a turn therefore never asks.
- `askMove(state, id, geo, ask): string | undefined`
  - The blocking form for a page with a `window.confirm`: the station to pass
    as `joinStation`, or undefined when the item keeps its own, asked or not.
- `moveNote(before, after, id): string | null`
  - What to say after a write: the station it changed to, or that it stands
    outside its circle after a move along the ground. Null otherwise.

## Invariants and assumptions

- Pure: no DOM, no store, no clock.
- `declined` never promises more than a No gives: when the item's own station
  cannot carry the spot (past `objectFits`), it says the item stays where it
  was, because the write is refused.
- The note compares `before` and `after`, so it describes the write that
  happened, not the one that was asked for. An identical state says nothing.
- Who asks how: the desktop and the phone use the blocking
  `confirmPausingFrames` through `askMove`, so nothing is pending; AR cannot
  (`window.confirm` is unavailable in an XR session) and asks in the object
  list (`object-editing.ts`), writing nothing until the answer.

## Example

```ts
const join = askMove(state, id, geo, confirmPausingFrames);
session.move(id, geo.lat, geo.lon, { joinStation: join });
const note = moveNote(state, session.state(), id);
```

## Tests

- `move-question.test.ts`: when it asks, the two forms of `declined`, the
  answers, and each note.
- `tour-document-move.test.ts` and `tour-document-move.property.test.ts`: what
  the document does with the answer.
