# gesture.ts

## Purpose

One drag of the gizmo, or one hold of the keys, from its start to its
end: what it shows meanwhile (`preview`) and the one edit it writes
(`edit`). Pure: the scene hands it the world it reads (`GestureWorld`) and
draws the preview; nothing here dispatches, so a drag's frames write
nothing to the store.

## Public API

- `startGesture(handle, target, pressedAt, world)` -> `Gesture | null`;
  null when there is nothing to grab (no ground and no level plane under
  the pointer) or the handle is not the target's (a dot on a pin or a
  photo).
  - `move`: the target follows the SAMPLED ground under the pointer
    (`world.groundUnder`), offset by where it was grabbed, keeping its
    height above the ground (`placedGeo`); Shift snaps to half metres. A
    `not-loaded` miss, or no ground height at the new place, waits and is
    tried again by `retry()` each frame; any other miss is dropped and the
    last spot stays.
  - `turn`: the heading follows the pointer's bearing round the centre on
    the level plane, whole degrees (15 with Shift).
  - `dot`: a station's found radius (`draggedRadiusM`) or a model's size
    (`draggedSizeM`).
  - Methods `move(pointer, fine)`, `retry()`, `waiting()`, `preview()`,
    `edit()` (null when nothing changed: no empty undo step).
- `startKeyGesture(target, world)` -> `KeyGesture`: `press(key)` applies a
  nudge (`nudgedGeo`), a turn (`turnedGeo`) or a lift (`liftedGeo`; items
  only - a station stands on the ground) to the pose reached so far;
  `preview()`, `edit()` (null when the presses cancel out).
- Types `GroundUnder` (a point, or a miss: `not-loaded`, `below-start`,
  `out-of-reach`, `above`), `GestureWorld` (`groundUnder`,
  `planeUnder`, `placeOf(at: WorldPoint)`, `groundAt(place)` in ellipsoidal
  metres), `GestureTarget`, `GestureEdit` (`item-pose`, `station-pose`,
  `radius`, `size`), `GesturePreview`, `Gesture`, `KeyGesture` (its `press` takes a nudge, turn
  or lift of `gizmo-maths.ts`).

## Invariants & assumptions

- One gesture, at most one edit, which the page writes as one undo step
  (`../editor/scene-edits.ts`).
- The ground under the target at the start is read lazily: it may load
  after the press.
- Over random hills with patchy unloaded ground a dragged item keeps its
  height above the ground (`scene-edits.property.test.ts`).

## Examples

```ts
const g = startGesture("move", target, pointer, world);
g?.move(next, false);
g?.edit(); // { kind: "item-pose", id, geo } or null
```

## Tests

`gesture.test.ts`: a move follows the ground from the grab, snaps with
Shift, waits on `not-loaded` and retries until it loads, drops the other
misses; a turn by the knob; a station's radius and a model's size by a
dot; a press that moved nothing writes nothing; a key hold adds its
presses up into one edit, leaves a station's height alone, and writes
nothing for presses that cancel out. The property tests live with
`scene-edits.ts`.
