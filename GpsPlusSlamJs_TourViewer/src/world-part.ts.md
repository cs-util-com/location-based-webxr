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
  tour lacks) and `paintText(canvas)`.
- `WorldPart` - `object` (what stands; placed by the renderer, never by the
  part), `tapTarget?` (what a tap is cast against; none: no tap),
  `update?({ seconds, viewer })`, `tap?()`, `leave?()`, `back?()`,
  `dispose()` (frees every geometry, material and texture it made).
- `paintText(canvas, { anisotropy? } = {})` - the one canvas-text texture:
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
  was. A null scene or no candidate asks no pick.

## Invariants & assumptions

- **Axes.** Metres, Y up, origin at the item's foot on the ground. Front is
  local +Z, right local +X. A station block's pose (`rotationFromHeading`,
  a turn of -heading about up in the NUE world: x north, y up, z east)
  turns local +X to the heading's bearing and local +Z to heading + 90
  degrees, the QR poster rule; `content-placement.ts` drops pitch and roll.
  Confirmed by a property test over headings.
- An empty `Object3D` is a valid part: mounted, placed and freed, never
  offered to a tap.
- A hidden station's part is never offered to the pick.
- The set is module-wide: every page that mounts parts (the visitor, the
  check pages) shares it, so a part must be unmounted by its `dispose`.
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

`world-part.test.ts`: `paintText`'s colour space and anisotropy (swept over
1, 4 and 16, and none), the mounted set as a property, the shown-only tap
(hidden, outside any station, no tap, no scene, a miss), an empty `Object3D` as a
part, the axes over headings, and `worldEnv` in both modes with an unknown
id. The door's delegation is in `play-kinds.test.ts`, the placement in
`content-placement.test.ts`.
