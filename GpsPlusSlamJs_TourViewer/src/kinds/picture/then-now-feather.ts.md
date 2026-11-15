# `kinds/picture/then-now-feather.ts` - then and now's soft edge

## Purpose

The old picture of a then-and-now view fades out over a thin band at its
border instead of ending on a hard line, as on the chosen picture page
(its `uFeather`). The band hides a small misalignment at the border and
lets the past melt into today.

## Public API

- `THEN_NOW_FEATHER = 0.035` - the band's width as a share of the
  picture's width; the top and bottom band is 1.5 x that share of its
  height.
- `thenNowFeather(u, v, feather = THEN_NOW_FEATHER) -> 0..1` - how much
  of the picture shows at `(u, v)`: the product of four `smoothstep`
  ramps, 0 at any edge, 1 inside. Off the picture or not a number: 0. A
  feather that is no positive number: 1 (no band).
- `thenNowFeatherMap() -> DataTexture` - the feather at its default width
  as a 256 px RGBA alpha map (three reads the green channel), linear
  filtering, clamped. Made once and shared.

## Invariants and assumptions

- Given as an `alphaMap`, so the overlay stays a `MeshBasicMaterial`: the
  view's opacity (`viewpoint-world.ts`) and the station's fade keep
  multiplying it. No shader of its own.
- The map's band spans 9 texels at the default width, so filtering keeps
  it a ramp; a band under about 0.025 would want a larger map.
- A part's disposal frees the map's GPU copy with its look
  (`disposeObject3D` frees every texture of a material); the data stays,
  and three uploads it again for the next part. 256 KB, once per station
  entry.
- The swipe mode of the chosen page (a line dragged across the screen,
  the old picture on its left) is not built here; it is a screen control.

## Examples

```ts
plane.mesh.material.alphaMap = thenNowFeatherMap();
plane.mesh.material.needsUpdate = true;
```

## Tests

`then-now-feather.test.ts`: the edges, the middle, the band widths and
monotone ramps swept over widths 0.02-0.08, bad input, the default, and
the shared map's channel, size and ramp. `viewpoint-world.test.ts`: only
then and now's plane carries the map.
