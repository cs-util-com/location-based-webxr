# edge-hint.ts

## Purpose

A short text's `edgeHint` view: a faint ring on the ground at its spot and a small tag with its caption that stands over the spot while it is in view and slides to the screen's edge, with an arrow, when it is not. Quieter than a sign: a small font and a translucent fill.

## Public API

- `EDGE_HINT` - the measures: insets, the tag's height above the spot, the in and out hysteresis (24 px in, 8 px out), the play depth.
- `ScreenSpot`, `TagPlace`, `edgeHintPlace(spot, W, H, size)` - pure: where the tag goes on a W x H screen, whether at the edge, and its arrow's angle.
- `edgeHintFullyInView(corners, W, H, margin)` - pure: whether the spot's corners are all in front and inside the screen by `margin`.
- `edgeHintPart(block, env): WorldPart` - the ring and the tag (and a chip for the compact look) as meshes.

## Invariants and defensive measures

- The tag is always inside the screen's insets, for any spot, in front or behind (a property test).
- The tag is a camera-space plate: each frame it is placed at a depth along the view axis (1 m in play, the spot's depth in edit, so the editor sees it at its spot), with the camera's rotation and a size from `metresPerPxAtOneM`. In play it draws over the world (`depthTest` off).
- Without a camera or a scale in the frame, the tag and chip are hidden and only the ring shows; a hidden mesh is also scaled to zero so a bounding box (the editor's) does not count it.
- In edit mode the tag always stands over its spot.
- Two hints that overlap do not step aside (not built).

## Example

```ts
const part = edgeHintPart(
  { id, kind: "shortText", view: "edgeHint", caption: "Toilets" },
  env,
);
part.update?.({ seconds, viewer, camera, metresPerPxAtOneM });
```

## Tests

`edge-hint.test.ts`: the place over a spot in view, at the edge for one aside and one behind, always on screen (property over three screens), the hysteresis, hiding without a camera, and the tag in front of the camera above a spot ahead.
