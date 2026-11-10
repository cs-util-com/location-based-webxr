# `kinds/audio/zone.ts` - an ambient sound in the world

## Purpose

An audio item in the `zone` view: an ambient sound that plays by itself and
loops while the visitor is within earshot, louder toward its centre, silent
beyond `maxM`. It has no stop of its own and takes no tap. Its mark is a
ground glow whose fade is the loudness curve.

## Public API

- (module-private) `zoneReachOf(block)` -> `ZoneReach`: the block's `maxM`, `minM` and
  `volume`, with `AMBIENT_DEFAULT_MAX_M` and full volume for those it lacks.
- (module-private) `zoneGlow(reach)` -> `{ object, dispose }`: a flat disc of radius `maxM`
  whose shader draws the alpha of the `zoneGain` curve, warm and faint.
- `zonePart(block, env)` -> `WorldPart`: the glow; in play an `update` that
  sets the background sound's level (`zoneGain` of the horizontal distance
  from the object's position, divided by the scale its folders draw it at:
  `inheritedScaleOf` of `../../placement/place-scale.ts`, so its reach
  grows with its drawn glow) every frame. In the editor: still and
  silent, the glow plus the speaker icon at the centre (`sound-icon.ts`)
  and the hearing range as a ring at `maxM`; only the icon is picked.
- `RANGE_RING` - `{ px: 3, minWidthM: 0.12, maxWidthM: 4 }`: the range
  line's least width on the screen and its bounds.
- `rangeRingWidthM(distanceM, metresPerPxAtOneM, maxM)` - the line's
  width (m): `px` on the screen at that distance, within
  `[minWidthM, min(maxWidthM, maxM)]`; a distance or lens that is not a
  positive finite number gives `minWidthM`.

## Invariants & assumptions

- The sound is made on the first frame, through
  `env.sound(block.audio, "background")`, and read only when its level is
  first above 0 (`world-sound.ts`).
- The glow's fade and the loudness use one curve, so what the visitor sees
  is what they hear.
- `dispose` frees the sound, the disc's geometry and its material (in
  the editor also the ring and the icon).
- In the editor the glow and the ring do not take a ray (`raycast` is a
  no-op), so a press inside the range away from the icon reaches the
  ground and the camera; the ring has no depth test, so the relief does
  not hide it, and is drawn at 19, under the icon (20) and the gizmo.
- The ring's width and the icon's size come from the frame's `camera`
  and `metresPerPxAtOneM` (the editor's stations layer hands them); a
  frame without them leaves both at their world sizes.
- The visitor's look is unchanged: no icon and no ring in play.

## Examples

```ts
const part = zonePart(block, env); // block.view === "zone"
part.update?.({ seconds: 1, viewer: [5, 1.5, 0] });
```

## Tests

`zone.test.ts`: the level by distance, the defaults, the editor's silence,
dispose, the ring and icon in the editor only, picked by the icon alone
(rays down inside the range hit nothing; one at the icon hits), and the
range line at least 3 px across from 5 m to 300 m with its caps. `play.test.ts`: the world door picks it for `zone`.
