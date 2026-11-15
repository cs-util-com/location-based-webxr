# `kinds/picture/spot-guide-look.ts` - the spot guide's meshes

## Purpose

The in-world guide to a viewpoint's spot, built in the viewpoint's frame
(the station's: north, up, east, the ground at height 0), as the chosen
picture prototype stands it: the footprint decal on the ground, the soft
light column on it, and the card on its post beside the spot. One guide
for every guided view; the rules are `spot-guide.ts`'s.

## Public API

- `spotGuideLook(viewpoint, view, year, picture, painters)` -
  `{ group, show(shade, viewer, seconds) }`.
  - `picture-spot-decal`: a `SPOT_DECAL_M` plane painted by
    `painters.spotDecal()`, flat 2 cm over the ground at the spot, turned
    by `viewpointYaw` so its arrow points the way to face; no depth write,
    render order 2.
  - `picture-spot-beam`: an open cylinder from the ground to 3.4 m, an
    amber shader strongest at its foot with a slow ripple (`uAlpha`,
    `uTime`); no depth write, both sides. It takes no tap.
  - `picture-spot-card` on `picture-spot-post`: the card painted by
    `painters.card` (the year, the view's two lines, the picture small
    where the view shows it), on a dark post, standing at `spotCardPlace`.
  - `show` sets the decal's, the column's and the card's opacity from the
    shade, hides the card and its post below 0.01 and the column below
    0.003, ripples the column by `seconds`, and turns the card to `viewer`
    (in the viewpoint's frame) with `spotCardTurn`.
- `SpotGuidePicture`, `SpotGuideLook`.

## Invariants

- No allocation per frame: `show` writes numbers into existing materials
  and transforms.
- Four materials, made once; the decal's and the card's maps are their
  materials', so `disposeObject3D` frees them.
- The video's stand-here spot (`kinds/video/video-look.ts`) keeps its own
  look; both share `viewpointYaw`.

## Tests

Through `viewpoint-world.test.ts`: the names per view, the guide at the
viewpoint under random item and folder poses and sizes, the shade on the
way in and on the spot, the card facing the visitor, what the card is
painted with, sharpen's card without the picture, the column held still on
reduced motion. The look itself is checked side by side against the
prototype in screenshots.
