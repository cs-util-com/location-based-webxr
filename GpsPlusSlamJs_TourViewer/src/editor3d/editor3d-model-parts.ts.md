# editor3d-model-parts.ts

## Purpose

A selected model's own parts in the editor's 3D view: its notes as
numbered discs over the canvas, its cutaway's sections as see-through
planes, and the maths that turns a click on the drawn model into a note's
or a section's place in the model file's own space.

## Public API

- `hitModel(raycaster, model)` - the first visible mesh hit of the drawn
  model (with a face), or null.
- `noteSpotOf(model, hit)` - the hit as a `ModelSpot`: the point by
  `model.worldToLocal`, the face's normal turned into world space by the
  hit mesh's matrix, then by the inverse of the model's world rotation;
  both rounded to 1e-3 (a millimetre in the file's metres), `-0` written as
  `0`.
- `sectionSpotOf(model, hit, cameraWorld)` - the hit point, and the model's
  axis (+-x, +-y, +-z) nearest the way to the camera: the side facing the
  creator is the one a cutaway removes (the format: what lies on the side
  the normal points to is cut away).
- `pickedEdit(pick, spot)` - the `ModelEdit` a waited click answers.
- `MISSED_MODEL` - said when the waited click meets no part of the model.
- `createModelParts(deps)` - `{ update(), stats(), dispose() }`:
  - `update()` each frame draws the selected model's discs (DOM buttons
    `.note-disc` in a `.model-notes` layer in the view's box, numbered,
    `.on` and `aria-pressed` for the note in focus, hidden behind the
    camera) and one plane per section (in a `model-sections` group of the
    scene, 1.2 times the model's size, the focused one darker), and the
    crosshair cursor while a click is waited for;
  - a click on a disc calls `deps.focusNote(index)`;
  - `stats()` gives each disc's centre on the canvas (or null) and the
    planes drawn, for the page's checks.

## Invariants and assumptions

- Places are in the model file's own space: the drawn object is the glb's
  root with the tour's scale, rotation and position set on it
  (`editor3d-stations.ts` `placeModels`), so `worldToLocal` undoes exactly
  those.
- Uniform scale only (the format's `sizeM`): the normal's direction
  transform is a rotation.
- The parts read the tour every frame and keep nothing of it: a redrawn
  model (a station re-rendered after an edit) is found again by id.
- The planes take no ray (`raycast` is a no-op) and the discs are not on
  the canvas, so neither changes what a click selects.

## Examples

```ts
const hit = hitModel(rayAt(pointer), drawn);
if (hit !== null) edits.model(id, pickedEdit(pick, noteSpotOf(drawn, hit)!));
```

## Tests

- `editor3d-model-parts.test.ts` - a turned, scaled, moved cube: the note's
  spot in model space, a miss, the section normal toward the camera from
  either side, the edit per wait, and the discs and planes drawn, the
  focused disc marked, a disc's click asking for focus, and `dispose`.
- `playwright-tests/editor3d-model.spec.js` - in the page: add, type,
  place again, focus from the disc and delete a note; add, name, flip and
  delete a section; the gizmo in each view.
