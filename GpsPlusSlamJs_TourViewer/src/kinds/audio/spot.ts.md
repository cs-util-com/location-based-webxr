# `kinds/audio/spot.ts` - a narration circle in the world

## Purpose

An audio item in the `spot` view: one circle on the ground. The narration
plays on a tap only, and only inside the circle; it pauses when the visitor
walks out and carries on when they come back; the visitor's own pause (a
second tap) keeps it off until tapped again. It plays on the voice channel,
so it is one voice among the page's (`world-sound.ts`). While the visitor is
inside, its player card (`narration-card.ts`) is open on the page's screen
(`WorldEnv.screen`).

## Public API

- `SpotPart` - a `WorldPart` plus `onInside(listener)`: the listener hears
  every change of inside; returns its unsubscribe. The part's own card opens
  and closes at the same change.
- `spotPart(block, env)` -> `SpotPart`: radius `block.radiusM`, or
  `NARRATION_DEFAULT_RADIUS_M`.

## Invariants & assumptions

- Inside is `circleInside` of the horizontal distance from the object's
  position, divided by the scale its folders draw it at
  (`inheritedScaleOf`, `../../placement/place-scale.ts`), so a narration
  in a folder scaled by 2 is heard from twice as far; with
  `NARRATION_MARGIN_M` (`sound-reach.ts`); it starts outside,
  so a tap before the first frame does nothing.
- A tap (or the card's button): outside or in the editor, nothing; inside,
  pause when playing, else play - from the start when it was heard to the
  end.
- The card: opened through `env.screen` on walking in, closed on walking
  out and on dispose, rendered every frame in between. No screen (the
  editor, or a page that gives none): no card. An overlapping circle's card
  takes the screen while the visitor is in both; leaving that circle brings
  this one's back (the screen rebuilds it, `world-part.ts` `screenIn`), and
  this circle's close stays the one that closes it. Its scrub seeks the voice
  (making the handle if there is none yet).
- Walking out holds a wanted voice; walking in carries it on. A voice the
  visitor paused is not wanted, so it stays off.
- The voice handle is made on the first tap inside (or the card's first
  seek); until then the card shows 0:00 / 0:00.
- The default radius (6 m, margin 1.5 m) holds while the AR view tracks the
  phone; under GPS alone it holds only from about 10 m in open sky
  (`sound-reach.ts.md`). Which default to ship is an open question.
- Its look is `narration-look.ts`'s plume, told each play frame what the
  voice does (idle, playing, paused by a tap, away while the visitor is
  out, heard to its end) and where the viewer stands, for its plate; in
  the editor the plate turns to the camera. The plate canvas is made only
  where a document exists. In the editor it also wears the speaker icon (`sound-icon.ts`)
  at its centre, ticked with the frame's camera; the visitor never sees
  it. There the icon is all a ray meets: the circle, the particles and
  the invisible tap cylinder take none (in play the cylinder still takes
  the visitor's tap).
- Leaving the station disposes the part, so a held narration does not carry
  on across a station's reload.

## Examples

```ts
const part = spotPart(block, env); // block.view === "spot"
part.onInside((inside) => log(inside)); // the card opens on its own
part.update?.({ seconds: 0, viewer: [2, 1.5, 0] });
part.tap?.(); // plays
```

## Tests

`spot.test.ts`: the tap only inside, the voice channel, hold beyond the
margin and carry on at return, the visitor's pause staying off, `onInside`,
the editor's silence, the speaker icon in the editor only, picked by its icon alone in the
editor (the tap cylinder still rayable in play), and dispose. `spot-card.test.ts`: the card opens
inside and closes outside, its button plays and pauses, a heard narration
plays again from 0, the first circle's card back after leaving an
overlapping one, a dispose that still frees the voice and the look when
the panel it pushed aside fails to build again (told once), and no card
in the editor or after dispose. `play.test.ts`: the world door picks it
for `spot`.
