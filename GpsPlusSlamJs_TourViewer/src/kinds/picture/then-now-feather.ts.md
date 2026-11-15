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
- `thenNowFeatherMap(feather = THEN_NOW_FEATHER) -> DataTexture` - the
  feather at that width as a square RGBA alpha map (three reads the green
  channel), linear filtering, clamped. 256 px, doubled (up to 4096) until
  the band spans at least 8 texels. Made once per width and shared.

## Invariants and assumptions

- Given as an `alphaMap`, so the overlay stays a `MeshBasicMaterial`: the
  view's opacity (`viewpoint-world.ts`) and the station's fade keep
  multiplying it. No shader of its own.
- The map grows with a thinner band, so filtering always keeps it a ramp
  (the default 0.035: 256 px; sharpen's 0.02: 512 px).
- The maps are never freed: one is shared by every part that shows that
  width, so a part detaches it from its materials before
  `disposeObject3D` (which frees every texture of a material) frees its
  look; otherwise one part's departure would drop the GPU copy another
  part still draws with.
- The swipe mode of the chosen page (a line dragged across the screen,
  the old picture on its left) is not built here; it is a screen control.

## Examples

```ts
plane.mesh.material.alphaMap = thenNowFeatherMap(0.02);
plane.mesh.material.needsUpdate = true;
// ... and before the look is disposed:
plane.mesh.material.alphaMap = null;
```

## Tests

`then-now-feather.test.ts`: the edges, the middle, the band widths and
monotone ramps swept over widths 0.02-0.08, bad input, the default, and
the shared map's channel, size and ramp, and one map per width with a
ramp of several texels. `viewpoint-world.test.ts`: each view's width,
and one part's disposal leaving the shared map alive for another.
