# place-edits.ts

## Purpose

The one edit of a placeable (`placeables.ts`) - what a gizmo drag, a key
hold, the inspector's typed place or a problem's fix writes - and its
write through the editor session: one call, so one undo step. A refusal
comes back with the words the page says.

## Public API

- `PlaceEdit`:
  - `{ kind: "pose", ref, geo }` - the placeable's whole pose in the
    world;
  - `{ kind: "extent", ref, value }` - its dots' value (a station's found
    radius, a model's size).
- `applyPlaceEdit(editor, edit, joinStation?)` -> `{ kind: "applied" }`
  or `{ kind: "refused", reason }`. The session call is chosen by the
  HOLDER the ref names, never by a block's kind:
  - a block's pose -> `editor.pose(id, geo)`: it keeps its station, or
    changes to `joinStation`, the creator's answer
    (`../editor/move-question.ts`);
  - a station's pose -> `editor.moveStation(id, geo)` (its blocks follow
    rigidly);
  - a station's extent -> `editor.editStation(id, { foundRadiusM })`;
  - a block's extent -> `editor.setExtent(id, value)` (the session
    refuses a block whose row has no size, or a value out of its row's
    bounds);
  - a plain folder's pose -> `editor.moveFolder(id, geo)`, its extent
    (its scale) -> `editor.scaleFolder(id, value)`: its items follow it.
- Type `PlaceEditOutcome`.

## Invariants & assumptions

- Exactly one session call per edit; nothing else changes the document.
- The page refreshes its views, ends a delete's Undo offer and tells the
  autosave (`../editor/edit-main.ts`, `commitSceneEdit`).

## Examples

```ts
const outcome = applyPlaceEdit(editor, {
  kind: "extent",
  ref: { kind: "station", id: "gate" },
  value: 12,
});
if (outcome.kind === "refused") toast(outcome.reason);
```

## Tests

`place-edits.test.ts`: each edit goes to its one call, once (a folder's
move and scale too); a refusal is passed on with its words. `place-edits.property.test.ts`: a drag over
random hills (amplitude 0, 5, 50, 300 m; reach 10, 100, 1000 m; patchy
unloaded ground) keeps the item's height above the ground at every step;
a gesture (an item's move and turn; a station's move, turn and radius;
reach 1, 20 and 200 m against a 25 m found radius; ground amplitude 0 and
50 m) written through the real session and undone restores the saved
manifest exactly.

## Bend

`{ kind: "bend", ref, deg }` (a ground arrow's knob) goes through
`editBlockField(id, "bendDeg", String(deg))`, so the knob is checked by
the same rule as a typed bend (whole range +-60 degrees) and is one undo
step with the same wording.

## Point

`{ kind: "point", ref, at }` (a short text's point, set by "Pick in 3D"
or dragged by its handle; `at` in the station's frame, metres) goes
through `editBlockField(id, "pointsTo", at.join(" "))`: the same path as
the inspector's three boxes, so the format's strict reader is the only
judge (each number within 1000 m of the station) and the refusal reads
the same.

## A viewpoint ref

- A pose edit for `{ kind: "viewpoint", id }` calls `editor.moveViewpoint(id, geo)`: one session call, one undo step, never the picture's own pose and never a station to join (the viewpoint stays in its station's frame).
- An extent edit for it is refused with "A viewpoint has no size to change." rather than resizing the picture.
- Tested in `place-edits.test.ts` ("moves a picture's viewpoint through its own call, and sizes none").
