# `kinds/picture/picture-paint.ts` - what the picture parts paint

## Purpose

The canvas painters of the picture looks, ported number for number from
the chosen picture prototype: the framed print's plate, its mat, the
cut-out's tag, the contact shadow, the small card (the spot guide's and
the plates of the viewer and the window) and the spot decal. The parts take them as
`PicturePainters`, so their tests run without a canvas
(`test-support/fake-picture-painters.ts`).

## Public API

- `PicturePainters`
  - `plate(words, widthM) -> { image, widthM, heightM }` - 520 px a metre;
    the year large in amber with a thin rule, the caption in up to three
    lines (`plate.ts`), the credit small and muted, a quiet "i" mark; its
    height follows its lines;
  - `mat(innerW, innerH, w, h)` - 420 px a metre, cream with a seeded
    grain (the same each time), a white bevel round the print and a
    shadow under the frame's top and left;
  - `tag(words)` - 560 px a metre, `TAG_WIDTH_M` x `TAG_HEIGHT_M`: the
    year, the tag line, "Tap for the story";
  - `shadow()` - a 128 px radial fade, its alpha the shadow;
  - `card(words)` - `words.ppm` (560 by default) px a metre,
    `widthM` x `heightM`, a dark rounded card: an optional thumbnail
    (rounded, clipped, `aspect` high per unit wide, mirrored upright
    inside its clip when `thumb.flipped` says the image is stored upside
    down, as a texture decoded pre-flipped for the GPU is), the year in amber and
    one or two lines (the second trimmed, none when blank); the tag is
    this card;
  - `spotDecal()` - 512 px: a dark disc, the amber ring, a dashed inner
    ring, two pale soles and the arrow at the top (the way to face).
- `canvasPicturePainters(doc = document)` - the painters on `doc`.
- `PaintedPanel`, `PlateWords`, `TagWords`, `CardWords`, `TAG_WIDTH_M`, `TAG_HEIGHT_M`.

## Invariants and assumptions

- Throws when the document gives no 2D context (a page without canvas).
- A one-line credit too wide is cut with an ellipsis (`fitLine`).

## Tests

The word cuts are `plate.test.ts`'s; `picture-paint.test.ts` records the
card's 2D calls on a fake document to pin the thumbnail's orientation
(mirrored inside its clip only when flipped). The painted look is checked on the
picture check page and in the side-by-side screenshots against the
prototype.
