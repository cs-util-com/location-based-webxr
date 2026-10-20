# image-planes.ts

## Purpose

The tour's recorded photos as textured planes, each at its capture spot and
facing as the camera faced, placed at the SCENE ROOT in raw GPS-world NUE.

## Public API

- `placeCapturedImagePlanes({ scene, poses, textures }): PlacedImagePlanes`
  - one plane per captured photo at its capture position with the
    capture's world-NUE QUATERNION verbatim (front faces the photographer's
    viewpoint - a window back in time), 1 m wide and sized by the image's
    aspect (4:3 without one); poses and textures are paired, the excess of
    either skipped. Returns `{ count, dispose() }`.
- `PlacedImagePlanes` - `{ count, dispose() }`.

## Invariants & assumptions

- **Scene root, raw NUE** - the framework's parenting rule for built-once
  geographic content (`ar-scene-hierarchy.ts`): children of `arWorldGroup`
  would need alignment-inverse coordinates, and raw NUE there
  double-applies the alignment.
- Textures come from `decodeFrameTexture` (the framework's
  orientation-correct decoder) - an `ImageBitmap`-backed texture must be
  pre-flipped, which the decoder owns.
- One geometry for every plane, scaled per mesh: a geometry per plane would
  be an unbounded allocation for a long walk.
- `dispose()` removes the meshes and frees the geometry, every material AND
  texture - a session re-entry must not leak GPU memory or duplicate
  content.

## Examples

```ts
const planes = placeCapturedImagePlanes({ scene: parent, poses, textures });
// ... the station leaves:
planes.dispose();
```

## Tests

`image-planes.test.ts` - the capture quaternion verbatim at the capture
position, pose/texture pairing, aspect sizing and full disposal.
