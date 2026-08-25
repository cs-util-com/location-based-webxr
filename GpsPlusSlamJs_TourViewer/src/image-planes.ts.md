# image-planes.ts

## Purpose

QD-3's visible payoff: a handful of the tour's streamed images as textured
planes ringed around the relocalized code, placed ONCE at the SCENE ROOT in
raw GPS-world NUE.

## Public API

- `placeImagePlanes({ scene, positionsNue, textures, centerNue }):
PlacedImagePlanes` — pairs positions with textures (excess of either
  skipped), sizes each plane by the image's aspect (1 m wide), turns it to
  face the ring centre, and returns `{ count, dispose() }`.

## Invariants & assumptions

- **Scene root, raw NUE** — the framework's parenting rule for built-once
  geographic content (`ar-scene-hierarchy.ts`): children of `arWorldGroup`
  would need alignment-inverse coordinates, and raw NUE there
  double-applies the alignment.
- Textures come from `decodeFrameTexture` (the framework's
  orientation-correct decoder) — an `ImageBitmap`-backed texture must be
  pre-flipped, which the decoder owns.
- `dispose()` removes the meshes and frees geometry, material AND texture —
  a session re-entry must not leak GPU memory or duplicate content.

## Examples

```ts
imagePlanes = placeImagePlanes({
  scene,
  textures,
  positionsNue: imagePlaneRingNue(centerNue, textures.length),
  centerNue,
});
// … session end:
imagePlanes.dispose();
```

## Tests

`image-planes.test.ts` — placement at NUE coordinates, aspect-driven
geometry, position/texture pairing, and full disposal.
