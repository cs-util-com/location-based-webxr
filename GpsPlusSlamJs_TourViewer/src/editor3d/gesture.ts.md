# gesture.ts

## Purpose

One drag of the gizmo, or one hold of the keys, from its start to its
end: what it shows meanwhile (`preview`) and the one edit it writes
(`edit`). Pure: the scene hands it the world it reads (`GestureWorld`) and
draws the preview; nothing here dispatches, so a drag's frames write
nothing to the store. It reads a PLACEABLE (`../placement/placeables.ts`)
and never asks what kind of thing it is: whether it turns, lifts or has
dots, and the dots' bounds, are its placement row's
(`../placement/placement-rows.ts`).

## Public API

- `startGesture(handle, target, pressedAt, world)` -> `Gesture | null`;
  null when there is nothing to grab (no ground and no level plane under
  the pointer) or the handle is not the target's: a dot on a placeable
  without dots (a pin, a sound), the knob on one that does not turn (a
  pin's label, a sound), the middle or the knob of a locked one.
  - `move`: the target follows the SAMPLED ground under the pointer
    (`world.groundUnder`), offset by where it was grabbed, keeping its
    height above the ground (`placedGeo`); Shift snaps to half metres. A
    `not-loaded` miss, or no ground height at the new place, waits and is
    tried again by `retry()` each frame; any other miss is dropped and the
    last spot stays.
  - `turn`: the heading follows the pointer's bearing round the centre on
    the level plane, whole degrees (15 with Shift).
  - `dot`: a reach (a station's found radius, `draggedRadiusM`) or a size
    or a factor (`draggedSizeM`), within the bounds of the target's
    extent; a group's (a folder's) factor within `groupScaleBounds`
    (0.2-5 by a drag, a factor beyond them kept as it was; the format
    itself accepts 0.1-10).
  - Methods `move(pointer, fine)`, `retry()`, `waiting()`, `preview()`,
    `edit()` (null when nothing changed: no empty undo step).
- `startKeyGesture(target, world)` -> `KeyGesture`: `press(key)` applies a
  nudge (`nudgedGeo`), a turn (`turnedGeo`, only on what turns) or a lift
  (`liftedGeo`, only on what lifts - a station stands on the ground) to
  the pose reached so far; `preview()`, `edit()` (null when the presses
  cancel out, or changed nothing).
- `poseLocked(target)`: the target's `locked`.
- `gestureTargetOf(placeable, centre)` -> `GestureTarget`: a placeable
  as a gesture reads it, with every dot its row gives (a station's reach,
  a model's size, a picture's width); a group's (a folder's) carries its
  `members` (their bodies are its grips, and a click on one picks it
  alone, `editor3d-input.ts`).
- `gizmoSubjectOf(target, now, centre, spanM?)` -> `GizmoSubject`: what
  the gizmo is drawn for, the target as a preview (or its rest) shows it;
  a group's with its members' reach (0 before they are drawn), which the
  scene measures from their drawings.
- Types `GroundUnder` (a point, or a miss: `not-loaded`, `below-start`,
  `out-of-reach`, `above`), `GestureWorld` (`groundUnder`, `planeUnder`,
  `placeOf(at: WorldPoint)`, `groundAt(place)` in ellipsoidal metres),
  `GestureTarget` (a placeable's `ref`, `geo`, `turns`, `lifts`,
  `extent`, `locked`, and the gizmo's `centre`), `GesturePreview`
  (`geo`, and the dots' `value` or null), `Gesture`, `KeyGesture` (its
  `press` takes a nudge, turn or lift of `gizmo-maths.ts`).
- The edit is a `PlaceEdit` (`../placement/place-edits.ts`): `{ kind:
"pose", ref, geo }` or `{ kind: "extent", ref, value }`.

## Invariants & assumptions

- One gesture, at most one edit, which the page writes as one undo step
  (`applyPlaceEdit`).
- The ground under the target at the start is read lazily: it may load
  after the press.
- Over random hills with patchy unloaded ground a dragged item keeps its
  height above the ground (`../placement/place-edits.property.test.ts`).
- A locked target starts no move and no turn (null); its dots still
  start a drag.

## Examples

```ts
const g = startGesture("move", target, pointer, world);
g?.move(next, false);
g?.edit(); // { kind: "pose", ref: { kind: "block", id }, geo } or null
```

## Tests

`gesture.test.ts`: a move follows the ground from the grab, snaps with
Shift, waits on `not-loaded` and retries until it loads, drops the other
misses; a turn by the knob, and none on a pin; a station's radius and a
model's size by a dot, each held to its row's bounds (a picture's width
and a model's size dragged alike end at their own bounds); a press that
moved nothing writes nothing; a key hold adds its presses up into one
edit, leaves a station's height and a pin's heading alone, and writes
nothing for presses that cancel out; a locked station: no move, no turn,
and its radius drag; a folder's scale drag held between 0.2 and 5 and
a factor beyond them kept. The property tests live with `place-edits.ts`.
`gizmo-equivalence.test.ts`: every row's gizmo, through
`gestureTargetOf`, `gizmoSubjectOf` and `gizmoLayout`, equals the
layout the editor drew before the placement rows (a frozen copy of it)
at camera distances of 5, 50 and 300 m, except the knob and stalk of
what does not turn; the dragged radius and size equal the frozen rules.

## A ground arrow's handles

- A dot on a `scale` extent sets it by `draggedScale` from the dot's
  distance (not by the ratio a `size` uses).
- `bend`: only on a target with `bendDeg`, never on a locked one; grabbed
  on the level plane, it previews `bendDeg` and edits `{ kind: "bend" }` on
  release (nothing when unchanged). The drawing itself redraws the bend on
  release; while dragging, the knob shows it.

## A short text's point handle

`GestureTarget.point` (`{ at, local }`, a sign's or a ground arrow's `pointsTo` in the world, and how a world point reads in its station's frame) adds the handle "point". `startGesture` refuses it without a point or on a locked target; the drag runs on the horizontal plane at the point's height (the grab offset kept), so the point moves on its own level and its height is set in the y box. `edit()` gives a `PlaceEdit` "point" with `local(now)`, or null when nothing moved. `GesturePreview.pointAt` carries the point for the gizmo while it moves.
