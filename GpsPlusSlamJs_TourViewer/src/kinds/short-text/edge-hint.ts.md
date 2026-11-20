# edge-hint.ts

## Purpose

A short text's `edgeHint` view: a faint ring on the ground at its spot and a small tag with its caption that stands over the spot while it is in view and slides to the screen's edge, with an arrow, when it is not. Quieter than a sign: a small font and a translucent fill.

## Public API

- `EDGE_HINT` - the measures: insets, the tag's height above the spot, the in and out hysteresis (24 px in, 8 px out), the play depth.
- `ScreenSpot`, `TagPlace`, `edgeHintPlace(spot, W, H, size)` - pure: where the tag goes on a W x H screen, whether at the edge, and its arrow's angle.
- `edgeHintFullyInView(corners, W, H, margin)` - pure: whether the spot's corners are all in front and inside the screen by `margin`.
- `HintRect`, `edgeHintStepAside(tags, H)` - pure: the tops of tags that overlap after they step aside, nearest first (the nearest keeps its place; a farther tag in view moves up over it, one at the edge down below it, `stepPad` px apart, past at most `stepTries` tags; a stepped tag stays inside the insets).
- `edgeHintPart(block, env): WorldPart` - the ring and the tag (and a chip for the compact look) as meshes.

## Invariants and defensive measures

- The tag is always inside the screen's insets, for any spot, in front or behind (a property test). A spot with no camera-frame direction (on the lens's axis) goes to the edge toward its screen point, or right from the centre.
- The tag is a camera-space plate: each frame it is placed at a depth along the view axis (1 m in play, the spot's depth in edit, so the editor sees it at its spot), with the camera's rotation and a size from `metresPerPxAtOneM`. In play it draws over the world (`depthTest` off).
- Without a camera or a scale in the frame, the tag and chip are hidden and only the ring shows; a hidden mesh is also scaled to zero so a bounding box (the editor's) does not count it.
- In edit mode the tag always stands over its spot.
- Tags that overlap step aside, in play only (in the editor each tag stands at its spot's depth). Each part lays out the same set from a board shared by the hint parts of the page: this frame's tags and, for a part not yet updated this frame, its tag of the frame before. A part whose station hides drops out after one frame, a disposed one at once. The board is a resource of the frame loop (screen boxes of one frame, like the mounted-part set of `world-part.ts`), not app state. A frame is told by its clock, which every part of one frame shares. The step is not damped: a tag jumps when the order by distance changes.

## Example

```ts
const part = edgeHintPart(
  { id, kind: "shortText", view: "edgeHint", caption: "Toilets" },
  env,
);
part.update?.({ seconds, viewer, camera, metresPerPxAtOneM });
```

## Tests

`edge-hint.test.ts`: the place over a spot in view, at the edge for one aside and one behind, always on screen (property over three screens), the hysteresis, the step aside (examples, the inset clamp, and a property that with room no two tags overlap and the nearest never moves), hiding without a camera, the tag in front of the camera above a spot ahead, and two parts at one spot whose tags step apart and come back once one is disposed.
