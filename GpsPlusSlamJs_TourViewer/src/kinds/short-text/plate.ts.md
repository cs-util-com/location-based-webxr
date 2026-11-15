# plate.ts

## Purpose

The words of a short text as a picture: wraps a caption and its description, lays them out on a sign's board or a pin's head (the board's size is the plate's size), and paints it on a canvas for a texture. Also the role's colour and glyph.

## Public API

- `PLATE_PX_PER_EM` - canvas pixels per letter height (112); a board of `bodyW` pixels is `bodyW / PLATE_PX_PER_EM` letter heights wide.
- `SHORT_TEXT_ACCENT` - one colour per role (instruction, label, warning), all three distinct.
- `SHORT_TEXT_DEFAULT_ROLE` - `label`, the role a block without one reads as.
- `Measure`, `ESTIMATED_MEASURE` - how wide a text is in a font; the estimate needs no canvas (Node, tests).
- `wrapText(text, maxW, measure)` - lines no wider than `maxW`, broken at spaces and inside a word longer than a line; never empty, never loses a character.
- `PlateStyle`, `SIGN_PLATE`, `PIN_PLATE` - a plate's look: caption weight, widest caption line (em), padding, corner radius, accent band and pointer (em). A sign's board has a 0.17 em band and no pointer (8.6 em lines); a pin's head no band, round corners and a 0.42 em pointer below the board (9.5 em lines).
- `PlateLayout`, `layoutPlate(style, caption, description, measure)` - the board's size, the caption's and the description's lines (at most six, the last ending " ..."), the icon's place, the band and pointer in pixels; `canvasH` holds the pointer. `layoutSignPlate(caption, description, measure)` is `layoutPlate(SIGN_PLATE, ...)`.
- (internal) `paintPlate(ctx, layout, role, opts)` - paints a laid-out plate, its band if it has one and its pointer.
- `SHORT_TEXT_DEFAULT_READ_AT_M` - 4 m, the reading distance a block without one is drawn for (the sign and the pin).
- `makeCanvas(w, h)` - a canvas and its 2D context, or null without a `document` or a context.
- `canvasMeasure()` - a canvas-backed `Measure`, or the estimate without a canvas.
- `Plate`, `paintedPlate(style, caption, description, role, opts)` - layout plus painted canvas (a null canvas in Node); `signPlate(...)` is `paintedPlate(SIGN_PLATE, ...)`.
- `glyphCanvas(role)` - the round glyph a sign or a pin turns toward `pointsTo`.

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

`plate.test.ts`: wrapping (examples and a property over any text), board growth, the six-line cap, the widest board (property), layout without a canvas, distinct accents, the pin's head without a band and with its pointer inside the canvas.
