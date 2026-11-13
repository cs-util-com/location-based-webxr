# plate.ts

## Purpose

The words of a short text as a picture: wraps a caption and its description, lays them out on a sign's board (the board's size is the plate's size), and paints the board on a canvas for a texture. Also the role's colour and glyph.

## Public API

- `PLATE_PX_PER_EM` - canvas pixels per letter height (112); a board of `bodyW` pixels is `bodyW / PLATE_PX_PER_EM` letter heights wide.
- `SHORT_TEXT_ACCENT` - one colour per role (instruction, label, warning), all three distinct.
- `SHORT_TEXT_DEFAULT_ROLE` - `label`, the role a block without one reads as.
- `Measure`, `ESTIMATED_MEASURE` - how wide a text is in a font; the estimate needs no canvas (Node, tests).
- `wrapText(text, maxW, measure)` - lines no wider than `maxW`, broken at spaces and inside a word longer than a line; never empty, never loses a character.
- `PlateLayout`, `layoutSignPlate(caption, description, measure)` - the board's size, the caption's and the description's lines (at most six, the last ending " ..."), the icon's place.
- (internal) `paintSignPlate(ctx, layout, role, opts)` - paints a laid-out plate.
- `makeCanvas(w, h)` - a canvas and its 2D context, or null without a `document` or a context.
- `canvasMeasure()` - a canvas-backed `Measure`, or the estimate without a canvas.
- `signPlate(caption, description, role, opts)` - layout plus painted canvas (a null canvas in Node).
- `glyphCanvas(role)` - the round glyph a sign turns toward `pointsTo`.

## Invariants and defensive measures

- The caption line is at most 8.6 letter heights wide; padding 0.55 / 0.42 em; the description at 0.62 em.
- A blank caption still gives one line (a space), so the board never has zero height.
- Without a canvas everything still lays out; only the picture is missing.

## Example

```ts
const plate = signPlate("North gate", "Built in 1632.", "label", {
  icon: true,
});
const widthInLetters = plate.layout.bodyW / PLATE_PX_PER_EM;
```

## Tests

`plate.test.ts`: wrapping (examples and a property over any text), board growth, the six-line cap, the widest board (property), layout without a canvas, distinct accents.
