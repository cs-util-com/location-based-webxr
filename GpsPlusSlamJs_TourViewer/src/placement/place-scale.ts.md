# place-scale.ts

## Purpose

The scale a drawing was made at, marked on the drawn object, so a drag's
preview can draw it at another value of its extent (a model's size, a
picture's width) and back, without asking what kind of thing it is.

## Public API

- `markPlaceScale(object, extent)` - marks `object`'s scale now as the
  one drawn for the extent value `extent` (`userData.placeScale`, the
  scale as `[x, y, z]`, and `userData.placeExtent`). A drawing calls it
  on the object whose scale carries its extent: a model's loaded scene
  (`../kinds/model/world.ts`), a picture's plane (`../image-planes.ts`).
  A non-positive or non-finite extent marks nothing.
- `drawInherited(object, scale)` - draws a block's root `scale` times
  larger than its own size (the scale of the folders holding it,
  `userData.placeInherited`). It SETS the scale: the root's scale is
  multiplied by `scale / inheritedScaleOf(object)`, so calling it again
  replaces the last one and calling it with the tour's value restores
  it. A place-scale mark on the root itself (a picture's plane) is
  multiplied with it, so `drawAtExtent` draws a dragged width at the
  folders' scale too; a mark on a child (a model's loaded scene) needs
  nothing, since the root's scale carries it. A scale that is no
  positive number draws it at 1. The renderer calls it for every block
  of a scaled folder (`../content-placement.ts`); the 3D editor for a
  folder's scale being dragged (`../editor3d/editor3d-stations.ts`).
- `inheritedScaleOf(object)` - that scale, 1 for none: what a sound's
  hearing range is divided by (`../kinds/audio/spot.ts`, `zone.ts`).
- `drawAtExtent(root, value)` - the first marked object under `root`
  (itself included, depth first) drawn at `value`: its marked scale times
  `value / placeExtent` on every axis, so a picture's plane keeps its
  aspect. `null`, or a value that is no positive number, draws it as it
  was drawn. Nothing for a root with no mark, or a mark that is no
  numbers.

## Invariants & assumptions

- The mark is the scale DRAWN, read after the drawing settled: a toy
  model starts smaller than its tour size, and the preview scales from
  what is on the screen.
- A drawing has at most one marked object; the first found wins.
- No three.js object is made here, only `userData` and `scale` written.

## Examples

```ts
plane.scale.set(2, 1.5, 1);
markPlaceScale(plane, 2); // drawn 2 m wide
drawAtExtent(plane, 4); // scale (4, 3, 2)
drawAtExtent(plane, null); // back to (2, 1.5, 1)
drawInherited(plane, 2); // its folder draws it twice as large: (4, 3, 2)
drawAtExtent(plane, 4); // a 4 m width at that scale: (8, 6, 4)
drawInherited(plane, 1); // its own size again: (4, 3, 2) / 2 = (2, 1.5, 1)
```

## Tests

`place-scale.test.ts`: a plane drawn wider and back, a nested mark found
under its root, an unmarked root left alone, a broken mark and bad values;
the folders' scale set, replaced and cleared, carried into a root's own
mark and not into a child's, and bad scales drawn at 1.
`place-scale.property.test.ts`: any marked scale and extent, any value,
scale by exactly `value / extent`; null restores the mark bit for bit; any
sequence of folder scales ends at the last one's, within rounding.
