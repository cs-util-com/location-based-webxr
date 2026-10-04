# scene-stage.ts

## Purpose

What a story shows in AR at its station (tour kit plan K4): a cut-out
character (a PNG figure, the castle's knight) standing on the station's
spot and turned towards the visitor, or a 3D model (`.glb`) placed with the
station's pose. At the scene root in the session's GPS-world NUE, like the
tour's other content (`content-placement.ts`). Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `createSceneStage(deps): SceneStage`
  - `showCharacter(stationId, imageBlob, size?)` / `showModel(stationId, glbBlob)`
    (`size` is the asset's stated pixel size, handed to `decodeTexture` for
    the decode cap)
    - replace what is shown; reject when the figure does not decode (so the
      story can say so); settle once mounted. A station with no position
      yet (no GPS zero, or a code-only station before the visitor's height
      is known) does not fail: the decoded figure or model waits and is
      mounted on the next `faceVisitor` that finds a pose (K4 review R8);
  - `clear()` - remove and dispose;
  - `faceVisitor(nue)` - mount what waits for its position, then turn a
    standing character about the vertical.
- Deps: `getScene()`, `poseOf(stationId)`, `decodeTexture(blob)`,
  `loadModel(blob)` (a `.glb` already checked inert by K0's
  `checkGlbInert`).
- `CHARACTER_HEIGHT_M` (1.7).

## Invariants & assumptions

- **The K4 build agent's choice, not the owner's** (the plan leaves it
  open): a character is 1.7 m tall, its aspect kept, its feet on the
  station's altitude, facing the visitor about the vertical only. A model
  takes the station's own rotation and is never turned.
- One thing at a time; a decode or model load that lands after `clear` or
  a newer show is disposed, never shown; so is one still waiting for its
  position (its show settles).
- The scene it was added to is kept for removal (the e2e scene root is a
  stub that sets no `parent`).
- Every removed subtree's geometries, materials and textures are disposed
  by the framework's `disposeObject3D` (every texture slot of a material,
  not only `map`: K4 review R12; no second dispose walk here, DEC-H3).

## Examples

```ts
const stage = createSceneStage({ getScene, poseOf, decodeTexture, loadModel });
await stage.showCharacter("gate", knightPng);
stage.faceVisitor(visitorNue);
```

## Tests

- `scene-stage.test.ts` - the figure's spot, feet and aspect; facing the
  visitor; a model's own rotation; replace and dispose; every texture of a model freed (R12); a late decode
  dropped; a figure that does not decode rejects; a mount waits for its
  position and is mounted once it has one, or freed by the next step (R8).
