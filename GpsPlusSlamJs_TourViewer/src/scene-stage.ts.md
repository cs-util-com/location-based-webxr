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
  - `showCharacter(stationId, imageBlob, onWaiting?)` /
    `showModel(stationId, glbBlob, onWaiting?)`
    (`decodeTexture` measures the figure from its own header: the size the
    tour declares is no longer passed, K4 review R2)
    - replace what is shown; reject when the figure does not decode (so the
      story can say so); settle once mounted. A station with no position
      yet (no GPS zero, or a code-only station before the visitor's height
      is known) does not fail: the decoded figure or model waits and is
      mounted on the next `faceVisitor` that finds a pose (K4 review R8);
      `onWaiting` is called once when it starts to wait, never for a
      figure mounted at once (the story says what it waits for; the
      guide's `figurePoseOf` holds the pose back until the alignment has
      a heading, r881 re-review M-B);
  - `clear()` - remove and dispose;
  - `faceVisitor(nue)` - mount what waits for its position, then turn a
    standing character about the vertical.
  - `follow(isShown)` - which stations' content shows now (the present
    one, or all under "show all"; `visitor-stations.ts` passes
    `selectStationContentShown` every tick): the figure fades with its
    station.
- Deps: `getScene()`, `poseOf(stationId)`, `decodeTexture(blob)`,
  `loadModel(blob)` (a `.glb` already checked inert by K0's
  `checkGlbInert`); optional `now()` (default `Date.now`), `fadeMs`
  (default `CONTENT_FADE_MS`, as the station's own content) and
  `registerFrame(fn)` (the AR frame loop, registered only while a fade
  runs).
- `CHARACTER_HEIGHT_M` (1.7).

## Invariants & assumptions

- **The K4 build agent's choice, not the owner's** (the plan leaves it
  open; B-15 as revised by K4 review R6): a character is 1.7 m tall, its
  aspect kept, its feet on the station's altitude, facing the visitor about
  the vertical only. A model takes the station's own rotation and is never
  turned. At a code-only station the guide's pose is already on the
  estimated ground below the code and turned about the vertical only, so
  the figure does not float at the poster's centre and a model takes the
  code's yaw, not its tilt.
- One thing at a time; a decode or model load that lands after `clear` or
  a newer show is disposed, never shown; so is one still waiting for its
  position (its show settles).
- The scene it was added to is kept for removal (the e2e scene root is a
  stub that sets no `parent`).
- **The figure follows its station's presence** (visitor plan
  2026-10-18-2349, "the figure fades, the audio plays on"): a figure whose
  station stops showing fades out (`content-fade.ts`) and leaves the scene
  but stays decoded; when the station shows again it comes back at
  opacity 0 and fades in, with no second decode. A figure decoded while its
  station is not shown waits off the scene, faded out. Mounted while its
  station shows, it stands at full opacity at once (the story's start, as
  before). The story panel and its sound are not the stage's: they play on.
  `clear` frees a figure on or off the scene alike. Until `follow` is
  first called every station counts as shown. The page follows on every
  tick; a settled figure writes no material (only a changing alpha is
  written).
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
  position and is mounted once it has one, or freed by the next step (R8);
  `onWaiting` once when a figure waits, never when it stands at once;
  the figure following its station (fades out and leaves the scene, comes
  back at 0 and fades in without a second decode; waits off the scene when
  decoded while hidden; `clear` frees a hidden figure; no material write
  while it stands settled).
