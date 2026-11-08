# `kinds/audio/spot.ts` - a narration circle in the world

## Purpose

An audio item in the `spot` view: one circle on the ground. The narration
plays on a tap only, and only inside the circle; it pauses when the visitor
walks out and carries on when they come back; the visitor's own pause (a
second tap) keeps it off until tapped again. It plays on the voice channel,
so it is one voice among the page's (`world-sound.ts`).

## Public API

- `SpotPart` - a `WorldPart` plus `onInside(listener)`: the listener hears
  every change of inside; returns its unsubscribe. A player card is meant to
  open and close by it.
- `spotPart(block, env)` -> `SpotPart`: radius `block.radiusM`, or
  `NARRATION_DEFAULT_RADIUS_M`.

## Invariants & assumptions

- Inside is `circleInside` of the horizontal distance from the object's
  position, with `NARRATION_MARGIN_M` (`sound-reach.ts`); it starts outside,
  so a tap before the first frame does nothing.
- A tap: outside or in the editor, nothing; inside, pause when playing, else
  play.
- Walking out holds a wanted voice; walking in carries it on. A voice the
  visitor paused is not wanted, so it stays off.
- The voice handle is made on the first tap inside.
- Its look is `narration-look.ts`'s, behind one function, until the look is
  decided.
- Leaving the station disposes the part, so a held narration does not carry
  on across a station's reload.

## Examples

```ts
const part = spotPart(block, env); // block.view === "spot"
part.onInside((inside) => card.toggle(inside));
part.update?.({ seconds: 0, viewer: [2, 1.5, 0] });
part.tap?.(); // plays
```

## Tests

`spot.test.ts`: the tap only inside, the voice channel, hold beyond the
margin and carry on at return, the visitor's pause staying off, `onInside`,
the editor's silence, and dispose. `play.test.ts`: the world door picks it
for `spot`.
