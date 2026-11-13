# `kinds/picture/picture-paint.ts` - what the picture parts paint

## Purpose

The canvas painters of the picture looks, ported number for number from
the chosen picture prototype: the framed print's plate, its mat, the
cut-out's tag and the contact shadow. The parts take them as
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
  - `shadow()` - a 128 px radial fade, its alpha the shadow.
- `canvasPicturePainters(doc = document)` - the painters on `doc`.
- `PaintedPanel`, `PlateWords`, `TagWords`, `TAG_WIDTH_M`, `TAG_HEIGHT_M`.

## Invariants and assumptions

- Throws when the document gives no 2D context (a page without canvas).
- A one-line credit too wide is cut with an ellipsis (`fitLine`).

## Tests

The word cuts are `plate.test.ts`'s; the painted look is checked on the
picture check page and in the side-by-side screenshots against the
prototype.
