# scene-edits.ts

## Purpose

A gesture of the 3D view (`../editor3d/gesture.ts`) written through the
editor session: one call, so one undo step. A refusal comes back with the
words the page says.

## Public API

- `applySceneEdit(editor, edit, joinStation?)` -> `{ kind: "applied" }` or
  `{ kind: "refused", reason }`:
  - `item-pose` -> `editor.pose(id, geo)`: it keeps its station, or
    changes to `joinStation`, the creator's answer (`../move-question.ts`);
  - `station-pose` -> `editor.moveStation(id, geo)` (its items follow
    rigidly);
  - `radius` -> `editor.editStation(id, { foundRadiusM })`;
  - `size` -> `editor.resizeModel(id, sizeM)`.
- Type `SceneEditOutcome`.

## Invariants & assumptions

- Exactly one session call per edit; nothing else changes the document.
- The page refreshes its views, ends a delete's Undo offer and tells the
  autosave (`edit-main.ts`, `commitSceneEdit`).

## Examples

```ts
const outcome = applySceneEdit(editor, {
  kind: "radius",
  id: "gate",
  foundRadiusM: 12,
});
if (outcome.kind === "refused") toast(outcome.reason);
```

## Tests

`scene-edits.test.ts`: each edit goes to its one call, once; a refusal is
passed on with its words. `scene-edits.property.test.ts`: a drag over
random hills (amplitude 0, 5, 50, 300 m; reach 10, 100, 1000 m; patchy
unloaded ground) keeps the item's height above the ground at every step;
a gesture (an item's move and turn; a station's move, turn and radius;
reach 1, 20 and 200 m against a 25 m found radius; ground amplitude 0 and
50 m) written through the real session and undone restores the saved
manifest exactly.
