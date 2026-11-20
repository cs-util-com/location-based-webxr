# bench-draw.ts

## Purpose

The benchmark page's result picture: frames A and B side by side at one scale, every keypoint as a dot, and the matches as lines, on a canvas of bounded size.

## Public API

- `PairLayout { width, height, scale, bx }`: the canvas size, the one scale both frames are drawn at, and the left edge of frame B.
- `sideBySide(a, b, maxWidth, gap)`: the layout that fits both frames and the gap in `maxWidth`, never enlarged (scale at most 1). Both frames share one scale, so a line leans only as much as the scene moved.
- `pickLines(n, cap)`: which of `n` match lines to draw: all of them when `n <= cap`, else `cap` indices spread evenly from the first (`floor(i * n / cap)`), distinct and in range. The lines shown are a cross-section, not only the strongest.
- `DrawContext`: the subset of `CanvasRenderingContext2D` used, so a recording fake can stand in for it in tests.
- `MatchPicture { layout, imageA, imageB, frameA, frameB, size, sample, lineCap }`.
- `drawMatches(ctx, picture)`: draws both images, 2 x 2 px dots (A yellow, B cyan) and one line per picked match in its own hue; returns the number of lines drawn.

## Invariants

- Keypoints come in the pixels of the size computed (`size`) and are mapped to the captured frame with `toFramePoint`, then scaled: pixel centre `v` lands at `(v + 0.5) x scale` on the canvas.
- Cost is bounded: the canvas is at most the page's width cap, and the line count at most `lineCap`, whatever a method returns.
- Pure apart from the context it is given; no DOM lookups.

## Example

```ts
const layout = sideBySide(frameA, frameB, 640, 8);
const drawn = drawMatches(ctx, {
  layout,
  imageA,
  imageB,
  frameA,
  frameB,
  size,
  sample,
  lineCap: 200,
});
```

## Tests

`bench-draw.test.ts`: layout fit and scale properties, the evenly spread line pick (property), and a recording context that checks image placement, dot and line positions and the cap.
