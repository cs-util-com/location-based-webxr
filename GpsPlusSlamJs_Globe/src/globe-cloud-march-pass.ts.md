# globe-cloud-march-pass.ts

Purpose: the near clouds' drawing pass: the march into a half-float target allocated once, of which each frame draws the share the distance scale asks for, and their ground shadow into a second target. It only draws: the mix, the tent filter and the tone curve are the shell's composite.

## Public API

- `createGlobeCloudMarch(renderer, { ellipsoid, surfaceUniforms, lifeSpeed? })`: returns `GlobeCloudMarch`.
- `ready`: true once `setBakes(bakes)` uploaded the tiles and both shaders are compiled (`compileAsync`, so the compile does not stall the frame that first draws them; a failed wait counts as done, the first draw compiles then). Until then `render` draws nothing and returns false, and the old clouds keep drawing.
- `render(frame: CloudMarchFrame): boolean`: draws one frame; true when the targets hold it.
- `texture`, `shadowTexture`: premultiplied radiance; shadow in alpha.
- `uv`, `resolution`: the share of the target this frame drew and the target's size, both shared with the composite.
- `state()`, `uniforms()`: what a page or a test reads.
- `dispose()`.

`CloudMarchFrame`: `camera`, `worldFromEcef`, `sunEcef`, `timeS` (the drift clock), `quality` (a tier's clouds), `pixelScale` (the step-down), `sceneDepth` (or null), `shadow` (strength, 0 none).

## Invariants

- The target is allocated at the tier's cap and changes only on a resize or a tier change; the scale moves `uv`.
- Its geometry: the ellipsoid scaled to the march's sphere, turned by the map's drift, so the camera's motion and the wind are one motion. The march itself needs no rotation.
- `uCloudOpacity` of the flat layer is not applied: the map decides. That is part of why the shell above shows less cover than the march below; see the step's lift.
- Lit by the check page's radiance; the shell's `sunIntensity` is not used.
- The render target and the clear state are put back.
- Near the skyline the low-resolution clouds against the full-resolution depth can show a thin halo; the shadow uses the scene's depth or the sea's sphere.

## Example

```ts
const march = createGlobeCloudMarch(renderer, { ellipsoid, surfaceUniforms });
march.setBakes(await requestCloudBakes(worker));
march.render({
  camera,
  worldFromEcef,
  sunEcef,
  timeS,
  quality,
  pixelScale: 1,
  sceneDepth: null,
  shadow: 0.3,
});
```

## Tests

`globe-cloud-march-pass.test.ts`: readiness, the share, allocation once, the drift's rotation, the frame's restored state.
