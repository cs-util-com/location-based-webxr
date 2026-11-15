# tree-drag-arm.ts

## Purpose

When a press on a drag grip becomes a drag, for `tree-drag.ts`'s `arm`: a
finger rests on the grip first, so a flick to scroll a list that happens
to start on a grip reorders nothing; a mouse or a pen drags once it has
moved a little, so a click on a grip marks nothing. Pure.

## Public API

- `TreeDragArm { holdMs, tolerancePx, movePx }` - a finger's rest before
  a move drags (ms), how far it may stray while resting (px), and how far
  a mouse or a pen moves before it drags (px). The values are the app's.
- `armState(arm, { pointer, distancePx, ms })` -> `"wait" | "drag" | "none"`:
  a press by `pointer` (the event's `pointerType`) moved `distancePx`
  from where it went down, `ms` after it.
  - `touch`: `drag` from `holdMs` on; before it, `none` past `tolerancePx`
    (kept: the caller stops asking), else `wait`.
  - any other pointer: `drag` from `movePx` on, else `wait`; time plays no
    part.
  - a distance or a time that is not finite: `none`.
- `armIsValid(arm)` - every value a finite number of 0 or more;
  `createTreeDrag` throws `RangeError` for any other.

## Invariants and assumptions

- The times are the events' own (`event.timeStamp`), never a timer: the
  rule is the same however late the page handles a burst of events, which
  is what makes it testable end to end (the phone specs send a gesture in
  one burst, each event with its own time).
- A finger held still sends no moves, so the hold is seen at the first
  move after it: nothing is marked while the finger rests.
- The caller asks only while the press waits; after `drag` or `none` the
  press is decided.

## Examples

```ts
armState({ holdMs: 150, tolerancePx: 6, movePx: 4 }, {
  pointer: "touch",
  distancePx: 12,
  ms: 16,
}); // "none": a flick
```

## Tests

`tree-drag-arm.test.ts`: swept over holds of 100-250 ms and tolerances of
4-8 px - a flick or a slow scroll from the grip never drags, a finger that
rested 300 ms always does, a 120 ms rest drags only at a 100 ms hold (the
hold is the boundary); a still finger waits until a move after the hold;
a mouse or a pen from its threshold on; values that are not numbers.
`tree-drag.test.ts` drives it through the drag.
