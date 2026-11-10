# `kinds/audio/sound-icon.ts` - the editor's speaker icon

## Purpose

The editor's mark of a sound in the world (an ambient sound, a narration
circle): a round speaker icon at the sound's centre that always faces the
camera, is never drawn smaller on the screen than `SOUND_ICON.minPx`, and
draws over the ground and buildings. A sound has no body to find it by,
so this icon is what the editor shows and picks it by. The visitor never
sees it.

## Public API

- `SOUND_ICON` - `{ sizeM: 0.9, minPx: 48, liftM: 0.6 }`: its diameter in
  the world when near, its least diameter on the screen (CSS px, the
  common touch-target size), and the gap between the ground and its
  lower edge.
- `soundIconSizeM(distanceM, metresPerPxAtOneM)` - its diameter (m):
  `sizeM`, or `minPx * distanceM * metresPerPxAtOneM` where that is more.
  A distance or lens that is not a positive finite number gives `sizeM`.
- `soundIcon()` -> `{ object, update(frame), dispose }`: `object` is a
  group (named `sound-icon`) whose foot is at the origin; `update` reads
  `{ camera?, metresPerPxAtOneM? }` (a `WorldFrame` fits); `dispose`
  frees its geometries and materials.

## Invariants & assumptions

- Built from flat shapes (a dark disc, an amber rim, the speaker and two
  waves), no canvas, so it draws and is tested the same in Node.
- Every mesh has `depthTest: false`: the relief and buildings never hide
  it.
- Every mesh draws at render order 20.5 (module-private): after the scene
  and the found-radius rings (20), so it never ties with a ring, and
  before the gizmo (21 and up), so the gizmo's disc stays on top.
- Facing: its face's turn is its parent's world turn undone, then the
  camera's, so it faces the camera through any turned parent.
- Its size is worked out from where its middle stood the frame before (a
  frame's lag, within a centimetre); its lower edge stays `liftM` above
  the foot whatever its size.
- Without a camera `update` leaves it as it is; `update` allocates
  nothing.

## Examples

```ts
const icon = soundIcon();
part.object.add(icon.object);
// each frame (the editor's stations layer hands both):
icon.update({ camera, metresPerPxAtOneM });
```

## Tests

`sound-icon.test.ts`: its least size on the screen across 5 m to 300 m at
50 and 70 degree lenses over 600 and 844 px views, its world size near,
the fallback for bad input, facing the camera through a turned parent at
the right size, standing still without a camera, no depth test, and its
draw order between the rings and the gizmo.
`zone.test.ts` and `spot.test.ts`: worn in the editor only.
