# pin.ts

## Purpose

A short text in its `pin` view as the world door draws it: a dark head
carrying the words (`plate.ts`, `PIN_PLATE`: a rounded tag with a
pointer below it) on a thin stem, over a dark disc and the role's ring on
the ground, with a soft pulse round the ring. It says "here" without
covering what is behind it.

## Public API

- `pinPart(block, env)` -> `WorldPart`: a `Group` named `short-text-pin`
  holding `pin-head` (two plate faces, front and back), `pin-stem`,
  `pin-disc`, `pin-ring`, `pin-pulse` and, with `pointsTo`, one
  `pin-arrow` per face. Its `tapTarget` is the head. Reached through
  `world.ts` (`shortTextWorld`).
- `pinMeasures(readAtM)` -> `{ em, liftM, stemR, groundM }`: the letter
  height, the head's height, the stem's radius and the ground mark's size
  for a reading distance, clamped to the format's 1..40 m.
- `PIN`: the measures below.

## Invariants & assumptions

- The head floats at 1.7 m plus 0.1 m per metre read (2.1 m at the
  default 4 m, 5.7 m at 40 m), so a pin read from far clears a crowd; the
  stem runs from the ground to the head; the pointer's tip sits on the
  stem's top.
- The stem's radius is 0.07 letter heights, at least 11 mm; the ground
  mark 2.4 letter heights, at least 0.22 m.
- Orientation, like the sign: absent and `world` keep the pose's turn (the
  row is turning, `placement/placement-rows.ts`); `upright` turns the
  head about the stem toward the visitor; `face` also tilts it toward the
  visitor's eyes (the pitch from the head to the viewer's position, not
  the camera's tilt). Turning is eased (`turnRate` 7/s).
- The head has two faces, so a `world` pin reads from behind.
- The arrow: in each face's own frame the target angle is
  `-atan2(x - glyph.x, -z)` of the point, so up means "past the pin",
  right and left are turns and down is "behind you", as the visitor sees
  it. A sign flip of that angle (the arrow pointing straight away from
  its point) fails four direction tests.
- The pulse: one swell every 2.8 s from 0.7 to 2.2 times its size, fading
  from 0.55 to nothing; still (at a fixed phase) in the editor and when
  the visitor asked for less motion (`env.reduceMotion`).
- All materials are unlit, transparent and write no depth, so the mark
  never hides the camera image as an opaque square; without a canvas (in
  Node) the plate and the halo are plain colours and everything still
  lays out.
- `dispose` frees every geometry, material and texture it made.

## Example

```ts
const part = pinPart(block, env);
station.add(part.object);
// each frame
part.update?.({ seconds, viewer: [x, y, z] });
// when the station goes
part.dispose();
```

## Tests

`pin.test.ts`: the head's height and the stem for reading distances
1..40, the clamp, the ring on the ground growing with distance, each
orientation's turn and tilt, both faces, the arrow's world direction
(past, right, left, behind) for every orientation and from behind a
`world` pin, no arrow without a point, the pulse moving in play and still
under reduce-motion and in the editor, and dispose.
