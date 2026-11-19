# then-now-swipe.ts

## Purpose

Then and now's Swipe: where the visitor's line stands (a share of the
screen's width) and the cut in the old picture's shader at that share.

## Public API

- `SWIPE_SPLIT_MIN` (0.04), `SWIPE_SPLIT_MAX` (0.96), `SWIPE_SPLIT_START`
  (0.5): the line's reach and its first place, as the chosen prototype.
- `clampSwipeSplit(split)`: into the reach; a split that is not a finite
  number is the start.
- `swipeSplitAt(clientX, left, width)`: a finger's x on a layer starting
  at `left` and `width` wide, as a clamped share; a width that is not
  positive, or a left that is not finite, gives the start.
- `SWIPE_EDGE_PX` (48) and `swipeReach(width)`: the reach narrowed so
  the knob's centre stays 48 px in from either edge of a screen `width`
  px wide (clear of Android's back gesture), the middle alone on a
  screen narrower than two margins; an unknown width gives the share's
  reach. `clampSwipeSplit(split, width?)` and `swipeSplitAt` clamp to it.
- `swipeMask(material)` returns `{ set(on, split), state() }`: patches a
  `MeshBasicMaterial` (`onBeforeCompile`, its own program cache key) so
  that, while on, it keeps only what is left of `split` on the screen.
  `set` clamps the split; `state()` reads back `{ on, split }`.

## Invariants & assumptions

- The cut is in screen space from the clip-space position
  (`x / w * 0.5 + 0.5`), so it needs no viewport size and holds in an XR
  layer as on a page; it is applied after the alpha map, so the feathered
  edges stay, with a soft edge of two pixels (one `fwidth` either side
  of the line).
- Off, the material draws as before (the branch is a uniform test).
- The old picture is left of the line: what is right of it is cut.

## Examples

```ts
const mask = swipeMask(plane.material);
mask.set(true, swipeSplitAt(event.clientX, rect.left, rect.width));
```

## Tests

`then-now-swipe.test.ts` (the mapping, the shader text against three's
real basic shader, the uniforms); `then-now-swipe.property.test.ts`
(within reach, monotone, under the finger, independent of the screen's
place); in a real browser `playwright-tests/then-now-check.spec.js`.
