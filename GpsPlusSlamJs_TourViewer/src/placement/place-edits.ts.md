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
  - a block's extent -> `editor.resizeModel(id, value)` (the session
    refuses a block that is no model).
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

`place-edits.test.ts`: each edit goes to its one call, once; a refusal is
passed on with its words. `place-edits.property.test.ts`: a drag over
random hills (amplitude 0, 5, 50, 300 m; reach 10, 100, 1000 m; patchy
unloaded ground) keeps the item's height above the ground at every step;
a gesture (an item's move and turn; a station's move, turn and radius;
reach 1, 20 and 200 m against a 25 m found radius; ground amplitude 0 and
50 m) written through the real session and undone restores the saved
manifest exactly.
