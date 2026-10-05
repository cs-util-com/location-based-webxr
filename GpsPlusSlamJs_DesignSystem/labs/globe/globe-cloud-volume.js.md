# globe-cloud-volume.js

## Purpose

The cloud volume in the globe lab (volume-cloud plan
`2026-10-05-0016-globe-volume-cloud-variants-plan.md`, C2): the framework's
ray-marched cloud slab near the camera, its clouds from the globe's own
cloud map (so the swap from the shell never plops), drawn after the Earth
and ending at the relief, so a ridge in front of a cloud hides it.

## Public API

- `createGlobeCloudVolume(renderer, { atmosphere, skyScene, surfaceUniforms })`
  (`atmosphere` and `skyScene` the ground sky's, `globe-ground-sky.js`)
  returns:
  - `setEnabled(on)`: the ground sky's slab mode (cover 1), the coverage
    chunk (`CLOUD_VOLUME_COVERAGE_GLSL` with the globe's map, drift and
    opacity uniforms, the target's origin and the share) and the relief's
    depth; off restores the dome. Idempotent.
  - `update({ altitudeKm, target, radiusKm, ceilingKm, shellHeightM })` →
    `{ share, radiusM }`: the share by altitude (`cloudVolumeShare`), the
    disc `radiusKm` x share, the lift (the shell's height minus the slab's
    middle), the origin from `target` (degrees; null before one: no
    volume).
  - `render(camera, relief)`: after the Earth, nothing at share 0: the
    relief's depth pass, the slab from the lifted camera, the composite.
  - `state()`: `{ enabled, share, radiusM, liftM, drawn }`.
  - `dispose()`.

## Invariants & assumptions

- **The relief's depth** comes from its own meshes with their colour
  writes off: the displacement is in their vertex shader, so an override
  material would draw them flat. Rendered with the relief alone as the
  scene, the relief's program compiles once more without the page's fog,
  on the first volume frame.
- **The height**: the framework's slab sits at 1.8-2.2 km; the slab is
  drawn from a copy of the camera lowered by the lift, which raises it to
  the shell's height (3 km x E). Noise, depth and distances are unchanged
  by a vertical shift. Its thickness (400 m) is not scaled with E.
- **The ground sky draws its sky without the slab** (it hides the slab in
  its own pass), so the clouds are drawn once, after the Earth.
- **The composite**: the slab's target holds premultiplied colour (three's
  normal blending into a cleared, alpha-0 target); the composite divides
  it back, tone-maps the straight colour and blends it by its alpha, as a
  direct draw to the canvas would.
- **Variant 1** (the lab's default): the shell's hole (`setHole`) has the
  disc's radius, both scaled by the share, so the clouds are drawn once at
  every altitude. Variant 2 keeps the whole shell.
- Only in the target's local frame (F2a), with the relief, below the
  ceiling, where the ground sky is supported.

## Examples

```js
const volume = createGlobeCloudVolume(renderer, {
  atmosphere: groundSky.atmosphere,
  skyScene: groundSky.scene,
  surfaceUniforms: globe.surfaceUniforms,
});
volume.setEnabled(true);
const { radiusM } = volume.update({
  altitudeKm,
  target,
  radiusKm: 20,
  ceilingKm: 40,
  shellHeightM,
});
renderer.render(scene, camera);
volume.render(camera, terrain.tiles.group);
```

## Tests

`globe-cloud-volume.smoke.spec.mjs`: the frame-to-frame step through the
volume's fade-in (45 to 15 km) against the shell only, that it draws at
the hold without a console error, and its frame cost. The arithmetic is in
`GpsPlusSlamJs_Globe/src/globe-cloud-volume.test.ts`, the slab's coverage
and disc in the framework's `cloud-slab.test.ts`.
