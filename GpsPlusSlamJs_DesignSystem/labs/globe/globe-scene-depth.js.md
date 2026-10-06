# globe-scene-depth.js

## Purpose

The drawn relief's depth, once a frame, for the two passes that must end
at it: the cloud volume's march (`globe-cloud-volume.js`, volume-cloud plan
`2026-10-05-0016-globe-volume-cloud-variants-plan.md`) and the space pass's
rays below the hand-over (`globe-atmosphere.js`, §17; the F2 plan's
accepted "no scene depth" limit, M1 R3 minor 10, which drew a hard edge at
the ellipsoid's limb on the owner's phone on 2026-10-06: the relief, drawn
three times as high, stood above the ellipsoid's horizon unveiled).

## Public API

- `createGlobeSceneDepth(renderer)` returns:
  - `texture`: a `THREE.DepthTexture`, 1 where nothing was drawn;
  - `camera`: the camera it was drawn with (the view camera with a near
    plane of at most 10 m); a reader reconstructs a point through its
    `projectionMatrixInverse`, never the view camera's;
  - `render(viewCamera, relief, extra = [])`: draws the depth of `relief`
    (an `Object3D`) and of each object in `extra` (the city, globe city plan
    2026-10-05-0040 §12.5 C4, so the space pass and the cloud volume end at
    buildings too) into the texture, sized to the drawing buffer, cleared
    once; restores the render target, the renderer's auto-clear and every
    colour write it turned off;
  - `beginFrame()` and `fresh`: whether the depth was drawn this frame, so
    a reader never uses a stale one;
  - `state()`: `{ frames, fresh, near }`;
  - `dispose()`.

## Invariants & assumptions

- **The relief's own meshes**, their colour writes off: the displacement is
  in their vertex shader, so an override material would draw them flat.
  Drawn with the relief alone as the scene, its program compiles once more
  without the page's fog, on the first depth frame.
- **Its own near plane** (at most 10 m): the camera's is fitted to the
  ground (0.3 x the clearance), so with it everything nearer than that
  would be missing from the depth (the volume's deck was clipped that way,
  2026-10-06). The depth texture still resolves the relief to about 2.5 m
  at 20 km.
- **The relief only.** The cloud shell is left out: the volume's deck
  stands around the shell's height, so ending its march at the shell would
  cut the deck's lower half.
- Drawn once a frame, after the Earth, when either reader needs it (the
  volume draws, or the space pass veils the ground below the hand-over).

## Examples

```js
const depth = createGlobeSceneDepth(renderer);
// each frame, after the Earth
depth.beginFrame();
if (needed) depth.render(camera, terrain.tiles.group);
// a reader
uniforms.uSceneDepth.value = depth.texture;
uniforms.uSceneInverseProjection.value.copy(
  depth.camera.projectionMatrixInverse,
);
```

## Tests

`globe-cloud-volume.smoke.spec.mjs` (the volume seen from just above the
deck: the near plane) and `globe-atmosphere.smoke.spec.mjs` (no unveiled
relief at the horizon below the hand-over).
