# splat-scene-render.ts

## Purpose

Renders the synthetic splat scene (`splat-scene.ts`) with three.js at given poses and returns each view as JPEG bytes, drawn with exactly the projection the walk's depth samples record.

## Public API

- `renderSceneFrames(poses, width, height, projection, onFrame?) -> Promise<Uint8Array[]>` - one JPEG per pose, in pose order; `onFrame(i)` after each. Rejects when WebGL or JPEG encoding is unavailable.

## Invariants & assumptions

- The camera's projection matrix is set from `projection` as given, never recomputed from a field of view, so photos and depth agree.
- Unlit materials (`MeshBasicMaterial`): a surface has one colour from every camera, as a splat's colour assumes.
- Textures are 256 px, tiled once per 2 m of a box's longest side, mipmapped.
- One renderer per call, on its own canvas, pixel ratio 1; the renderer, geometries, materials and textures are disposed when the call ends, whatever its outcome.
- JPEG quality 0.9.

## Examples

```ts
const jpegs = await renderSceneFrames(
  poses,
  320,
  240,
  sceneProjection(320, 240),
);
```

## Tests

- Needs WebGL, so no unit test: `playwright-tests/splat-scene-check.spec.js` renders a straight and a loop walk under a software renderer and checks that the first photo decodes at the size asked for and is not a flat colour.
