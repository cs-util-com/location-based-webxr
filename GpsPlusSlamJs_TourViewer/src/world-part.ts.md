# `world-part.ts` - a kind's part in the world

## Purpose

What an item stands in the world as, the same for every kind: one three.js
object, and what the page may ask of it (a tap, a frame, going). Every hook
has its driver:

- `tap` - the visitor's tap (`tapShownWorldPart`, from `main.ts`);
- `update` - the camera frame (`tickWorldParts`, from `main.ts`
  `hooks.tickStations`); its first callers are the audio kind's zone and
  narration circle (`kinds/audio/`), which hear the visitor's distance;
- `dispose` - the renderer, when the station's content goes.

Leaving and coming back (`leave`/`back`) were part of the first draft and
still have no driver, so they are not in the type: they come with one (the
station's leave and return) when a kind needs it.

The renderer (`content-placement.ts`) places a part at the block's
pose; the part never touches the scene, the camera, the renderer or the
frame loop. A kind gives its part through its row (`play-kinds.ts`
`world?`, read by `worldPartOf`); the reading stand (`lectern-view.ts`) and
the reading sign (`reading-sign.ts`) are world parts too.

## Public API

- `WorldMode` - `"play"` (a visitor) or `"edit"` (the editor: the same
  object, still and silent).
- `WorldEnv` - what a part is built with: `mode`, `loadAsset(id)` (a tour
  file by asset id; rejects with `no file "<id>" in the tour` for an id the
  tour lacks), `canvasTexture(canvas)`, `loadModel(id)` (a tour file read
  as a three.js model by the page's parser; rejects with
  `this page reads no model` where the page gives none),
  `enableClipping()` (the renderer's clipping switch a model's cutaway
  asks for; a no-op where the page gives none), `sound(id, channel)` (a
  `world-sound.ts` `SoundHandle` for an audio asset on the `"voice"` or
  `"background"` channel; in the editor always the silent handle), and
  `screen?` (the page's `WorldScreen`, in `play` only).
- `WorldEnvOptions` - what a page gives its env, every field optional:
  `sound` (the page's `createWorldSound`; none: silence), `screen` (handed
  on in `play` only), `parseModel(blob)` (a glb as a model, `glb-model.ts`;
  none: a model is refused) and `enableClipping()` (none: ignored).
- `WorldScreen` - `show(build)`: `build(host)` fills a fresh panel and
  returns its clean-up; `show` returns the close. `screenIn(host)` is the
  page's (`main.ts`, `#narration-card-root`): one panel at a time, the newest
  shown: a newer one takes the older down (its clean-up runs) and, once it
  closes, the older is built again, so its own close still closes it (two
  overlapping narration circles hand the screen back and forth); a build
  that throws shows nothing and gives the screen back; a stale close does
  nothing. A close never throws: when the panel it brings back fails to
  build again, that error goes to `screenIn(host, { onError })` (the
  page's walk toast; default `console.error`), so a part's dispose that
  closes its panel first still frees its sound and its look. First user: the
  narration circle's player card.
- `WorldPart` - `object` (what stands; placed by the renderer, never by the
  part), `tapTarget?` (what a tap is cast against; none: no tap),
  `update?({ seconds, viewer, camera?, metresPerPxAtOneM?, selected? })` (driven by
  `tickWorldParts` in play, by the editor's stations layer in the editor,
  which also hands the camera, its lens and the editor's selection - the
  selected block id, a station's `station:<id>`, or null; absent in play), `tap?()`,
  `ready?` (a promise that settles once a part that loads something
  stands; the renderer places the part at once and never waits for it, so
  a model file holds back no other block, and a rejection then disposes
  the part, takes it out of the station and its count, and names the
  block in `skipped`),
  `dispose()` (frees every geometry, material and texture it made).
- `canvasTexture(canvas, { anisotropy? } = {})` - a canvas as a texture (painted words, a figure, a shadow blob):
  sRGB, and the anisotropy only when given (a page seen at a slant; three
  clamps it to the renderer's largest).
- `worldEnv(mode, assets, load, options = {})` - a page's `WorldEnv`: an
  asset id is read through `load` by the path the tour's `assets` name for
  it; a model through `options.parseModel` after that; a sound is made by
  `options.sound` and reads its file the same way; `options.screen` is
  handed on in `play` only, so an editor part never opens a panel.
- `tickWorldParts(scene, viewer, nowMs, parts = mountedWorldParts())` - every
  camera frame (`main.ts` `hooks.tickStations`): each shown part with an
  `update` gets `{ seconds: nowMs / 1000, viewer }`, the camera's world
  position in the part object's parent frame (the frame its `position` is
  in, so a part measures its distance with no matrix of its own). No scene
  or no camera: nothing is ticked. A hidden station's parts are not ticked,
  so its sounds keep their last level until it is left (and disposed).
- `mountWorldPart(part)`, `unmountWorldPart(part)` (false when it was not
  mounted, so a second `dispose` is a no-op), `mountedWorldParts()` (oldest
  first) - the one mounted set.
- `tapShownWorldPart(scene, pick, tap, parts = mountedWorldParts())` - the
  visitor's tap (`main.ts`, the `part` route of `visitor-stations.ts`
  `routeVisitorTap`): among the parts shown under a station's content group
  (`model-visitor.ts` `shownIn`) that have both `tap` and `tapTarget`, the
  one `pick` (the page's `pickObjectInView`) names is tapped; true when one
  was. A null scene or no candidate asks no pick. Every kind's part is in
  the one pick, so the nearest exact hit along the ray wins
  (`object-pick.ts`), whatever the kind: a sign in front of a stand takes
  the tap. Before the parts shared one pick, the stands were picked on
  their own, ahead of everything else.

## Invariants & assumptions

- **Axes.** Metres, Y up, origin at the item's foot on the ground. Front is
  local +Z, right local +X. The renderer sets the part's rotation to its
  block's pose rotation as it stands (`block.pose.rotation`, under the
  station's frame, which `objectPoseNue` places): pitch and roll included.
  Only the stand and the sign are set upright, by their own arm of
  `content-placement.ts`; a part from the door keeps any tilt the pose has.
  Where front points is therefore the block's rotation, and two
  conventions write one (NUE: x north, y up, z east):
  - the editor's facing (`character-views.ts` `facingRotation(deg)`, a
    turn of 90 - deg about up) turns front, local +Z, to the facing `deg`;
  - the QR poster rule (`content-placement.ts` `rotationFromHeading(h)`, a
    turn of -h about up, used for a geo pose given by heading alone) turns
    local +X to the heading and front to heading + 90 degrees.
    Both are confirmed by property tests over headings.
- An empty `Object3D` is a valid part: mounted, placed and freed, never
  offered to a tap.
- A hidden station's part is never offered to the pick.
- The set is module-wide: every page that mounts parts (the visitor, the
  check pages) shares it, so a part must be unmounted by its `dispose`.
- **The editor builds through the same door.** Both 3D views hand the
  stations layer `worldPartOf` (`editor3d/editor3d-drawings.ts`), which
  it asks with `worldEnv("edit", ...)`: a door kind's part in the editor
  is the object the visitor's page builds, at the same pose. There is no
  second preview path. The one difference is the kind's own: a placed
  model stands plain in `edit`, without its view (`kinds/model/world.ts`),
  since the editor drives no view's frame.
- **Not done yet.** `tap?()` takes no hit: the part does not hear where
  on its `tapTarget` the tap landed.
- Not in the set yet: the model views (`model-visitor.ts` keeps its own,
  with the model card's tap ahead of every part) and the story's figure
  (`free-items.ts`, whose object belongs to the scene stage shared with
  the story).

## Examples

```ts
const env = worldEnv("play", manifest.assets, loadContent);
const part = worldPartOf(block, env); // null: nothing stands
if (part !== null) {
  stationGroup.add(part.object);
  mountWorldPart(part);
}
// on a tap:
tapShownWorldPart(scene, pickObjectInView, tap);
```

## Tests

`world-part.test.ts`: `canvasTexture`'s colour space and anisotropy (swept over
1, 4 and 16, and none), the mounted set as a property, the shown-only tap
(hidden, outside any station, no tap, no scene, a miss), the nearer of two
parts on the ray through the real `pickObject`, an empty `Object3D` as a
part, the axes of both rotation conventions over headings, `worldEnv` in both modes with an unknown
id, a model read through the page's parser with the clipping switch passed
on, the refusal without a parser, its sound in both modes, and
`tickWorldParts` (shown only, the parent frame, no scene, no camera). The
door's delegation is in `play-kinds.test.ts`, the placement (the
pose's rotation kept, tilt included, and a part that unmounts itself in its
own dispose still freed) in `content-placement.test.ts`.
