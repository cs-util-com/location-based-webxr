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
  from the object's position) every frame. In the editor: the glow only,
  still and silent.

## Invariants & assumptions

- The sound is made on the first frame, through
  `env.sound(block.audio, "background")`, and read only when its level is
  first above 0 (`world-sound.ts`).
- The glow's fade and the loudness use one curve, so what the visitor sees
  is what they hear.
- `dispose` frees the sound, the disc's geometry and its material.

## Examples

```ts
const part = zonePart(block, env); // block.view === "zone"
part.update?.({ seconds: 1, viewer: [5, 1.5, 0] });
```

## Tests

`zone.test.ts`: the level by distance, the defaults, the editor's silence,
and dispose. `play.test.ts`: the world door picks it for `zone`.
