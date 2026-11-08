# `world-part.ts` - a kind's part in the world

## Purpose

What an item stands in the world as, the same for every kind: one three.js
object, and what the page may ask of it (a tap, a frame, leaving and coming
back, going). The renderer (`content-placement.ts`) places it at the block's
pose; the part never touches the scene, the camera, the renderer or the
frame loop. A kind gives its part through its row (`play-kinds.ts`
`world?`, read by `worldPartOf`); the reading stand (`lectern-view.ts`) and
the reading sign (`reading-sign.ts`) are world parts too.

## Public API

- `WorldMode` - `"play"` (a visitor) or `"edit"` (the editor: the same
  object, still and silent).
- `WorldEnv` - what a part is built with: `mode`, `loadAsset(id)` (a tour
  file by asset id; rejects with `no file "<id>" in the tour` for an id the
  tour lacks) and `canvasTexture(canvas)`.
- `WorldPart` - `object` (what stands; placed by the renderer, never by the
  part), `tapTarget?` (what a tap is cast against; none: no tap),
  `update?({ seconds, viewer })`, `tap?()`, `leave?()`, `back?()`,
  `dispose()` (frees every geometry, material and texture it made).
- `canvasTexture(canvas, { anisotropy? } = {})` - a canvas as a texture (painted words, a figure, a shadow blob):
  sRGB, and the anisotropy only when given (a page seen at a slant; three
  clamps it to the renderer's largest).
- `worldEnv(mode, assets, load)` - a page's `WorldEnv`: an asset id is read
  through `load` by the path the tour's `assets` name for it.
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
  second preview path.
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
part, the axes of both rotation conventions over headings, and `worldEnv` in both modes with an unknown
id. The door's delegation is in `play-kinds.test.ts`, the placement (the
pose's rotation kept, tilt included, and a part that unmounts itself in its
own dispose still freed) in `content-placement.test.ts`.
