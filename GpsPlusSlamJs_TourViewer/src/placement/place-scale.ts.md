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
```

## Tests

`place-scale.test.ts`: a plane drawn wider and back, a nested mark found
under its root, an unmarked root left alone, a broken mark and bad values.
`place-scale.property.test.ts`: any marked scale and extent, any value,
scale by exactly `value / extent`; null restores the mark bit for bit.
