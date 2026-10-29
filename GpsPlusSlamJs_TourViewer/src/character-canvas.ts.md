# character-canvas.ts

## Purpose

The 2D canvas painting of a character's look, ported from the station-blocks-7 prototype:

- the speech bubble with its tail;
- the name tag (pip);
- the scroll of the pop-up stage;
- the stage top, the backdrop arch and the blob shadow;
- the die-cut figure: a white cut edge with a dark rim, and a card-brown back with grain.

Layout (wrapping and sizes) is separated from painting, so it can be tested in node with an injected text measure.

## Public API

- `CHARACTER_SANS` and `CHARACTER_SERIF` (module-internal): font stacks.
- `MeasureText(text, font, spacingPx?)`, and the module-internal `canvasMeasure`, the real one, backed by a 2D context.
- `wordsOf(text)` and `wrapWords(words, maxW, width)`: greedy wrapping. A word wider than the line keeps a line of its own.
- Bubbles:
  - `BUBBLE` (pad 54, font 64, lineH 82, minW 440, maxW 1024, tailH 58, radius 44);
  - `bubbleLayout(content, measure)` returns `{w, h, bodyH, lines, tipX}`;
  - `bubbleTipX(w, side)`: the tail tip sits 30 px from the edge nearest the head.
- `PIP` and `pipLayout`; `scrollLayout` (its sizes, `SCROLL`, module-internal).
- Painters: `paintBubble`, `paintPip`, `paintScroll`, `paintStageTop`, `paintBackdrop` and `paintBlob`. Each returns `Painted {image, w, h}`, or `PaintedTail` with a `tipX`.
- `paintFigure(source)` returns `PaintedFigure {front, back, figureW, figureH, pad}`:
  - the source is scaled to at most `FIGURE_MAX_PX` (1024) high;
  - `dieCutPad(h)` = `max(3, round(14/1024 * h))`.

## Invariants

- Widths are clamped to `[minW, maxW]`, so a long word never makes a canvas wider than 1024 px.
- The painters need a DOM canvas. Layout functions need only the measure.

## Deviations from the prototype

- The backdrop is the arch without the keep.
- There are no sprite frames.

## Tests

- `character-canvas.test.ts`: wrapping, the bubble width and its clamp, the tail tip, the pip and scroll sizes, and the die-cut pad. It uses a mono measure of 30 px per character.
- The painted look is checked in the browser by `playwright-tests/character-views.spec.js`.
