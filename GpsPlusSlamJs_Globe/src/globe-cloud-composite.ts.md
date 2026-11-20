# globe-cloud-composite.ts

## Purpose

The cloud composite: ONE full-screen mix over the frame of the spherical
shell's target and the slab's, premultiplied and weighted, with the
shell's ground shadow under both and the high layer over or under them by
its height. Moved out of `globe-cloud-shell-volume-pass.ts`, which owns
the targets, draws this material on its full-screen triangle and decides
each frame's weights.

## Public API

- `createGlobeCloudComposite({ shell, shadow, high })`: the composite
  reading the shell pass's three target textures (held by identity, so a
  resized target is read without a rebind).
  - `material`: the `ShaderMaterial` (transparent, no depth test or
    write), for the caller's full-screen triangle.
  - `apply({ shellIn, shadowStrength, high, cameraKm, slabTexture,
slabWeight })` (`GlobeCloudCompositeFrame`): the frame's switches and
    weights into the material.
  - `dispose()`: frees the material (the targets are the caller's).

## Invariants

- The mix is a premultiplied weighted sum, never one over the other, so
  the hand-over keeps the opacity: the shell times its fade-in less the
  slab's share of the cloud the slab draws at that pixel
  (`cloudShellPixelWeight`: r = the slab's alpha over the shell's), plus
  the slab times its share.
- The slab is weighed only with its texture (0 without it, so no old
  frame's slab is read).
- The ground shadow and the high layer are switched on only while the
  shell is in (`shellIn > 0`); the shadow only with a strength above 0.
- The high layer is laid premultiplied over the clouds from above its
  height and under them from below (`cloudLayerOver`), at full strength.
- The output is straight colour through three's tone mapping and colour
  space, its alpha blended over the frame; a pixel under 1e-4 alpha is
  discarded.

## Examples

```ts
const composite = createGlobeCloudComposite({
  shell: target.texture,
  shadow: shadowTarget.texture,
  high: highTarget.texture,
});
const quad = fullScreen(composite.material);
composite.apply({
  shellIn,
  shadowStrength,
  high,
  cameraKm,
  slabTexture,
  slabWeight,
});
renderer.render(quad.scene, quadCamera);
```

## Tests

- `globe-cloud-composite.test.ts`: the targets by identity, the shadow
  and high-layer switches only while the shell is in, the high layer's
  order by height, the slab weighed only with its texture, dispose.
- Through a whole frame: `globe-cloud-shell-volume-pass.test.ts` (the
  composite's uniforms at each draw) and the snapshots of
  `globe-cloud-default-look.test.ts`.
