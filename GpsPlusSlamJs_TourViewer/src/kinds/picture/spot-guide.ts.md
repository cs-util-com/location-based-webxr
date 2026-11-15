# `kinds/picture/spot-guide.ts` - the way to a viewpoint's spot

## Purpose

The pure rules of the in-world guide that leads a visitor to the spot a
picture was taken from: what each view's card says, where the card stands
beside the spot, which way it turns, and how much of the decal, the light
column and the card shows for where the visitor is and how far the picture
has taken over. No three.js objects; `spot-guide-look.ts` builds the
meshes, `viewpoint-world.ts` feeds the shade in each frame.

## Public API

- `SPOT_GUIDE_VIEWS`, `SpotGuideView`, `isSpotGuideView(view)` - the views
  with a guide: then and now, the finder, sharpen and the window. The
  viewer is its own mark (its stand, halo and plate) and has none.
- `SPOT_CARD_LINES[view]` - the card's two lines, the chosen prototype's.
- `spotCardHasThumb(view)` - false for sharpen, whose picture stays a
  surprise until the visitor arrives.
- `SPOT_DECAL_M` (1.5 m), `SPOT_BEAM` (0.05 m radius, 3.4 m high),
  `SPOT_CARD` (0.8 m wide, 1.05 m to the visitor's side of the spot and
  0.25 m behind it, on a 1.08 m post, its foot 1.05 m up, tilted back
  0.18 rad), `SPOT_CARD_FADE_M` ([1.6, 0.8] m).
- `spotCardSize(aspect, withThumb)` - the card's size: room for the
  thumbnail (`0.71 * aspect`) only when it shows one and the aspect is a
  positive number.
- `spotCardPlace(viewpoint)` - the card's foot on the ground, in the
  viewpoint's frame.
- `spotCardTurn(cardX, cardZ, viewerX, viewerZ, last)` - the turn about up
  that faces the card's +Z to the visitor; `last` when the visitor is on
  the card or not a number.
- `spotGuideShade(view, distanceM, takeover, cardFade?)` -
  `{ decal, beam, card }`, each in [0, 1]: the decal dims by the view's
  share (0.6 or 0.7) of the take-over, the card fades out from 1.6 m to
  0.8 m from the spot, the column shows the lesser of the two. A distance
  that is not a number shows the card whole.

## Invariants

- The card stands off the decal for any heading (property test).
- The beam never shows more than the decal or the card.
- The screen hints ("Walk to the marker N m", "Turn this way") are a
  page's, not the world's: `card` (from the distance) and the reach's
  off-axis angle are what such a hint would read.

## Swept parameters

- The decal size by the card's offset (1.2, 1.5, 2 m by 0.9, 1.05, 1.3 m):
  only a 2 m decal with a 0.9 m offset puts the card on the decal; the
  chosen pair keeps more than 0.3 m clear.
- The card fade ([1.2, 0.75], [1.6, 0.8], [2.4, 1.2] m): each is gone at
  the decal's edge and whole at 3 m.

## Tests

`spot-guide.property.test.ts`.
