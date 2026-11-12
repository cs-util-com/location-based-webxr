# ambient-occlusion.ts

## Purpose

Screen-space ambient occlusion for the 3D apps (OsmDemo first): three's own
`GTAOPass`, computed after the frame is drawn and multiplied onto it in
place. Creases where walls meet the ground, roofs meet walls and furniture
stands on the street darken; open ground, the sky and the hazed distance do
not.

The look and its values come from the design system's look-dev page
(`GpsPlusSlamJs_DesignSystem/3d/ambient-occlusion.js`), where the page runs
the same pass inside an effect composer. The apps draw straight to the
canvas instead, so this module adds the AO AFTER the frame rather than
inside a post-processing chain:

1. the app draws its frame as always (`renderer.render(scene, camera)`);
2. `render()` runs the pass with three's output off: a normal/depth pass of
   the scene (with the objects below left out), the GTAO, and the Poisson
   denoise, all into the pass's own targets;
3. one full-screen quad multiplies the canvas by the denoised AO
   (`DstColor x src`, alpha kept), faded out with view depth.

So a frame with the AO switched off is the frame the app always drew: no
pass runs, nothing is allocated, nothing is drawn. Fog, tone mapping and the
sky stay exactly where three puts them.

## Public API

- `AO_PARAMS` (frozen): `radius` 5 m, `distanceExponent` 1, `thickness` 8 m,
  `distanceFallOff` 1, `scale` 1, `samples` 16, `screenSpaceRadius` false,
  `intensity` 1, `fadeStartM` 300, `fadeEndM` 700. Every field except the
  fade window is held equal to the look-dev copy by
  `tests/repo-config/ambient-occlusion-copies.test.js`; consumers pass their
  own fade window (OsmDemo: 700-1400 m).
- `AO_DENOISE` (frozen): the Poisson denoise (`radius` 8 px, `lumaPhi` 10,
  `depthPhi` 2, `normalPhi` 3, `samples` 16, `rings` 2, `radiusExponent` 2).
- `AO_NOISE_SEED` (1), `aoNoiseRandom(seed)`: mulberry32 in [0, 1);
  `RangeError` for a seed that is not an integer.
- `aoNoiseTexture(seed?)`: three's denoise noise (four simplex channels over
  a 64 x 64 repeating RGBA8 `DataTexture`) built from the seeded generator,
  so the AO looks the same on every load. `Math.random` is never used.
- `hiddenFromAoNormals(object)`: `true` for sprites, lines (`Line2`
  included) and points, and for a mesh none of whose materials is visible,
  opaque and depth-writing. A group, or anything else not drawn itself, is
  never left out.
- `aoBlendFactor(ao, intensity, viewDepthM, fadeStartM, fadeEndM)`: the
  linear factor the blend applies, `1 + (ao - 1) * intensity * keep` with
  `keep = 1 - smoothstep(fadeStart, fadeEnd, viewDepth)` (the package's shared
  `utils/smoothstep.ts`, GLSL's curve). The shader computes
  the same expression; the property tests pin its shape.
- The blend raises the linear factor to the power 1 / 2.2 (the module-private
  `AO_DISPLAY_EXPONENT`) before multiplying, because the canvas it multiplies is already
  tone-mapped and sRGB-encoded (see below).
- `createAmbientOcclusion({ renderer, scene, camera, params?, denoise?,
resolutionScale?, noiseSeed?, enabled? })` returns `AmbientOcclusion`:
  - `enabled` (get/set): whether `render` draws. Switching costs nothing and
    needs no rebuild.
  - `render()`: multiplies the AO onto the frame just drawn to the
    renderer's current target. Returns whether it drew. Builds the pass on
    the first enabled call (so an app that boots with the AO off never
    constructs it) and re-sizes it when the drawing buffer changes.
  - `built`, `pass` (read-only; `null` before the first enabled `render` and
    after `dispose`), `params` (the merged, frozen parameters).
  - `dispose()`: frees the pass, its GTAO and blend materials (three's own
    dispose leaves both behind), this module's blend material and the quad. `render` does
    nothing afterwards.
  - Errors: `TypeError` without a `THREE.Scene` or a `PerspectiveCamera`;
    `RangeError` for a non-finite parameter, an intensity outside [0, 1], a
    fade window that is not `0 <= start < end`, a resolution scale outside
    (0, 1], or a seed that is not an integer. All are checked at creation.

## Invariants & assumptions

- **Content is never touched.** No material is patched, no shader chunk is
  replaced; the scene's `overrideMaterial` is set only inside three's
  normal/depth pass and is `null` again afterwards.
- **Every object gets back exactly the visibility it had.** The module hides
  the objects `hiddenFromAoNormals` selects, remembering each one's previous
  `visible`, and restores those values (in a `finally`). three's own pass
  would set lines and points back to `visible = true`, which would show a
  line the app had hidden; because the module hides them first, three's own
  cache stays empty.
- **No shadow map renders inside the AO.** The normal/depth pass is a full
  `renderer.render`; `shadowMap.autoUpdate` and `needsUpdate` are switched
  off for the pass and the blend and restored afterwards. The render target
  and `autoClear` are restored too.
- **The multiply happens in display space.** The canvas holds the frame
  after tone mapping and sRGB encoding, so a linear multiply there would
  darken by the encoded factor. The blend raises the factor to `1 / 2.2`, a
  gamma fit of the sRGB curve. That makes it LIGHTER than the look-dev
  page's linear multiply before its output pass, not equal to it: measured
  on one frame (OsmDemo, the Meggen capture at the city-look lab's landing
  pose, desktop), the darkest wall foot went from 75 to 43 here and from 75
  to 31 on the look-dev path, and over the pixels both darken the mean
  ratio was 0.90 here against 0.83 there (a drop of 6 against 10 levels).
  The tone mapping between the two points is why the gamma argument does
  not carry over. One pose, so the size of the gap is provisional. A factor of
  exactly 1 stays exactly 1, which is what keeps the fogged distance and an
  intensity-0 frame bit-identical to the frame without AO.
- **The fade is by view depth, the haze by distance along the ray.** Toward
  the frame's edges a point is farther than its view depth (55 degree
  vertical field: about 13 % at the top and bottom edges, 30 % at the
  sides), so the AO fades a little later there than the haze would suggest.
- **What the AO cannot see.** A transparent overlay (the heat grid, a route
  line) is left out, so its pixels get the AO of what is behind it. The
  override material draws front faces only, so a double-sided mesh seen from
  its back is missing from the AO's depth. A vertex-shader displacement in a
  content material (a debug ground displacement) is not reproduced by the
  override material.
- **The normal/depth pass has no multisampling**; the AO is computed at one
  sample per pixel and multiplied onto the antialiased canvas.
- **Cost scales with the scene**: the normal/depth pass re-renders every
  visible mesh with the override material, plus two full-screen passes and
  the blend. `resolutionScale` trades it against detail.
- **Not for AR.** The module knows nothing about XR; the apps keep it out of
  their AR renderer (OsmDemo's AR builds its own renderer and never imports
  this module).

## Examples

```ts
import { createAmbientOcclusion } from 'gps-plus-slam-app-framework/visualization/ambient-occlusion';

const ao = createAmbientOcclusion({
  renderer,
  scene,
  camera,
  params: { fadeStartM: 700, fadeEndM: 1400 },
  enabled: true,
});

renderer.render(scene, camera);
ao.render(); // multiplies the AO onto the frame just drawn

ao.enabled = false; // the next frame is the plain frame again
ao.dispose();
```

## Tests

- `ambient-occlusion.test.ts` (three's real `GTAOPass` against a recording
  renderer, no GPU): the exclusion rule; the normal/depth pass drawn without
  the left-out objects; every object's previous visibility restored (a
  hidden line stays hidden); no content material patched; the blend drawn
  last onto the target that was current, without a clear, with the multiply
  blend; the shadow map flags off during the pass and restored; the fade's
  uniforms from the camera of the frame; the display exponent (1 / 2.2) and
  the shader's factor and fade held to `aoBlendFactor`'s expression (source
  text, so a change to one twin that misses the other fails); the targets sized from the drawing
  buffer and the resolution scale; the seeded noise in the pass; lazy build,
  switch-off, dispose; the `RangeError`s.
- `ambient-occlusion.property.test.ts`: the blend factor only darkens, never
  below the AO, is exactly 1 past the fade and at intensity 0, never grows
  darker with distance; the exclusion rule over random material mixes; the
  generator in [0, 1) and repeatable for any integer seed.
- `tests/repo-config/ambient-occlusion-copies.test.js`: the parameters, the
  denoise, the seed and the generator equal the look-dev copy, fade excepted.
- The frame itself is OsmDemo's e2e
  (`GpsPlusSlamJs_OsmDemo/playwright-tests/scene-3d.spec.js`): the darkening
  is bounded (nothing brightens, the mean and the lit surfaces keep more than
  90 %) and switching off restores the frame bit-identically. It does NOT
  cover the sky or the fogged distance: no fixture pose shows a sky that
  stands still between frames. Those rest on the identity argument above (a
  factor of exactly 1 past the fade) and on the spike that measured fog boxes
  at 1-3 km unchanged.
