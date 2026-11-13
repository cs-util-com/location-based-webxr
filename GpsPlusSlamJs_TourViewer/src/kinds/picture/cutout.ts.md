# `kinds/picture/cutout.ts` - a cut-out's look

## Purpose

Builds the `cutout` view's look: the picture standing on its foot (its
alpha cuts it out, `alphaTest` 0.02), a dark silhouette from behind, a
soft contact shadow, and unless `showTag` is false a tag on a stake in
front with the year and the tag line.

## Public API

- `CUTOUT_BACK_OPACITY = 0.6` - the silhouette's opacity from behind.
- `cutoutFacingFade(facing, toViewer)` - `smoothstep(0.1, 0.4, |n . v|)`
  for level unit vectors: 0 within about 6 degrees of edge-on, 1 from
  about 24 degrees off its plane, the same from front and back.
- `buildCutoutLook(picture, aspect, tag | null, painters)` ->
  `{ root, tapTarget, face(placed, viewer) }`
  - origin at the foot, facing local +Z, built 1.6 m wide (the caller
    scales the root);
  - `face` sets the front's opacity to the fade and the back's to 0.6
    times it, from the placed object's pose and the viewer in its parent
    frame; a viewer straight above it changes nothing.

## Invariants and assumptions

- A picture without see-through parts shows as its rectangle; the reader
  cannot tell, the editor warns when the view is picked.
- The shadow takes no ray (`raycast` is a no-op), so it never takes a tap.

## Tests

`world.test.ts`: the tag switch, the foot, the facing fade in the part,
and properties of `cutoutFacingFade` (bounded, symmetric, monotone, its
two edges).
