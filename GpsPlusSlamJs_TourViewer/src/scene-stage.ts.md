# scene-stage.ts

## Purpose

The character a story shows in AR at its station: a character look
(`character-look.ts`, painted from his PNG figure or frames sheet) standing
at his block's place in the station's frame, turning toward the visitor by
itself. At the scene root in the session's GPS-world NUE, like the tour's
other content (`content-placement.ts`). A model in a story is not the
stage's: it stands in the world through its row, as every placed model
does. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `createSceneStage(deps): SceneStage`
  - `showCharacter(stationId, imageBlob, onWaiting, look)` with
    `look: StageCharacterLook { view, name, line, voiced?, sheet?, pose?, noCard?, scale? }`
    (`sheet`: the image is a frames sheet the look slices; `scale`: how much
    larger to draw him, his folders' scale, applied with `drawInherited`). The decoded
    image (`decodeTexture` measures the figure from its own header, never
    the size the tour declares) is painted into a character look and the
    decoded texture is freed.
    - replaces what is shown; rejects when the figure does not decode (so
      the story can say so); settles once mounted. A station with no
      position yet (no GPS zero, or a code-only station before the
      visitor's height is known) does not fail: the look waits and is
      mounted on the next `faceVisitor` that finds a pose; `onWaiting` is
      called once when it starts to wait, never for a figure mounted at
      once (the story says what it waits for; the guide's `figurePoseOf`
      holds the pose back until the alignment has a heading).
    - He stands at the block's pose position in the station's frame (its
      holder never turned) and rests at the yaw of the station's rotation
      times the block's; his beckon starts from where he stands.
  - `setVoice(voice, durationMs?)` - `"idle" | "speaking" | "spoken"`,
    with the voice clip's length when known (the look scales its
    read-along to it), kept across a figure's replacement (the voice may
    start before the figure stands); it reaches a released look too, so
    his voice played by a tap after the story moves his mouth;
  - `clear()` - remove and dispose;
  - `release()` - the story ended: a standing look stays, heard (so it
    beckons in two stations), unreached by the next story's voice, until
    its station stops showing; once faded out it is cleared for good, so
    he does not come back on a return. A look still waiting (or not in the
    scene) is cleared as by `clear`;
  - `characterTapTargets()` - the parts of the standing look that show
    (`CharacterLook.tapTargets`), for the visitor's tap; empty while none
    stands in the scene;
  - `toggleBubble()` - a voiceless bubble view's tap;
  - `faceVisitor(nue)` - mount what waits for its position (the look turns
    itself; the holder is never turned).
  - `follow(isShown)` - which stations' content shows now (the present
    one, or all under "show all"; `visitor-stations.ts` passes
    `selectStationContentShown` every tick): the figure fades with its
    station.
- Deps: `getScene()`, `poseOf(stationId)`, `decodeTexture(blob)`;
  optional `now()` (default `Date.now`), `fadeMs` (default
  `CONTENT_FADE_MS`, as the station's own content) and
  `registerFrame(fn)` (the AR frame loop, registered only while a fade
  runs, and while a look stands); optional `getCamera()` (the viewer's
  camera a look turns and opens to; null: it stands still),
  `beckonOf(stationId)` (the next station as an NUE offset from his pose
  and its title, or null), `lookPainters` (tests run without a canvas)
  and `figures` (a `figure-memo.ts`: a look stands from what was painted
  before, without a decode; absent, every look decodes and paints).
- `CHARACTER_HEIGHT_M` (1.7).

## Invariants & assumptions

- A look paints on a canvas, which keeps the flip the decoder gave a
  bitmap for WebGL, so the stage says so when it paints
  (`paintPoses(..., !texture.flipY)`).
- A character is 1.7 m tall, his aspect kept, his feet (the look root's
  origin) at the station's altitude plus his pose's height.
- One thing at a time; a decode that lands after `clear` or a newer show
  is disposed, never shown; so is a look still waiting for its position
  (its show settles).
- The scene it was added to is kept for removal (the e2e scene root is a
  stub that sets no `parent`).
- **The figure follows its station's presence** (the figure fades, the
  audio plays on): a look whose station stops showing fades out
  (`content-fade.ts`, through the look's own `setPresence`) and leaves the
  scene but stays painted; when the station shows again it comes back at
  presence 0 and fades in, with no second decode. A look decoded while its
  station is not shown waits off the scene, faded out. Mounted while its
  station shows, it stands at full presence at once (the story's start).
  The story panel and its sound are not the stage's: they play on.
  `clear` frees a look on or off the scene alike. Until `follow` is first
  called every station counts as shown. The page follows on every tick; a
  settled look is not given its presence again (only a changing alpha is
  written).
- Every removed subtree's geometries, materials and textures are disposed
  by the framework's `disposeObject3D` (every texture slot of a material,
  not only `map`; no second dispose walk here).
- **A character look** turns itself every rendered frame against the
  camera (its holder is never turned). It opens at once on mounting (the
  first update snaps), fades by its own `setPresence` (never a subtree
  opacity cache, since the look changes its material opacities per
  frame), and its frame is registered again on every `follow` (a
  session's end clears the frame registry). `clear` disposes the look and
  unregisters its frame.

## Examples

```ts
const stage = createSceneStage({ getScene, poseOf, decodeTexture });
await stage.showCharacter("gate", knightPng, undefined, {
  view: "speak",
  name: "Sir Kay",
  line: "Welcome.",
});
stage.follow((id) => id === "gate");
```

## Tests

- `scene-stage.test.ts` - his spot, feet and height; replace and dispose;
  a late decode dropped; a figure that does not decode rejects; a mount
  waits for its position and is mounted once it has one, or freed by the
  next step; `onWaiting` once when a look waits, never when it stands at
  once; the look following its station (fades out and leaves the scene,
  comes back at 0 and fades in without a second decode; waits off the
  scene when decoded while hidden; `clear` frees a hidden look; no
  presence written while it stands settled). The look's presence and
  disposal are read through a wrapper around `createCharacterLook`.
- `scene-stage.test.ts` "a character in a story view stands as a
  character look": it stands unturned and opens at once, ticks per frame
  (the bubble closes as the camera walks off), follows a voice set before
  it stood (the beckon is asked), fades by its presence and leaves the
  scene, `clear` stops its frames, and no camera is no error; the block's
  pose and its facing toward the camera; a released look staying,
  beckoning, until its station is left, never back; `release` clearing a
  look still waiting; `characterTapTargets` and `toggleBubble`; the voice
  and its length reaching a released look; a frames sheet sliced by the
  look only when the spec says `sheet`; a figure painted before is
  neither decoded nor painted again.
