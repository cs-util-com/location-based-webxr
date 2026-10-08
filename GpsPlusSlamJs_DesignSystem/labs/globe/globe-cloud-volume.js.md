# globe-cloud-volume.js

## Purpose

The cloud volume in the globe lab (volume-cloud plan
`2026-10-05-0016-globe-volume-cloud-variants-plan.md`, C2): the framework's
ray-marched cloud slab near the camera, its clouds from the globe's own
cloud map (so the swap from the shell never plops), drawn after the Earth
and ending at the relief, so a ridge in front of a cloud hides it.

## Public API

- `createGlobeCloudVolume(renderer, { atmosphere, skyScene, surfaceUniforms,
sceneDepth })`
  (`atmosphere` and `skyScene` the ground sky's, `globe-ground-sky.js`;
  `sceneDepth` the relief's depth, `globe-scene-depth.js`, shared with the
  space pass) returns:
  - `setEnabled(on)`: the ground sky's slab mode (cover 1), the coverage
    chunk (`CLOUD_VOLUME_COVERAGE_GLSL` with the globe's map, drift and
    opacity uniforms, the target's origin and the share) and the relief's
    depth; off restores the dome. Idempotent.
  - `update({ altitudeKm, target, radiusKm, ceilingKm, shellHeightM })` →
    `{ share, radiusM }`: the share by altitude (`cloudVolumeShare`), the
    disc `radiusKm` x share, the lift (the shell's height minus the slab's
    middle), the origin from `target` (degrees; null before one: no
    volume), and, while enabled, the ground sky's noise offset
    (`cloudVolumeNoiseOffset` at the map's drift, wrapped at
    `CLOUD_NOISE_PERIOD_TILES`, where the hex-tiled field repeats), which
    anchors the noise to the ground, plus the shift carried across every
    frame recentre since (`cloudVolumeRecentreShift`, so a ground point
    keeps its noise when the frame moves; the owner's clouds jumped when he
    zoomed out and back in, 2026-10-08): with the frame centred on the target, a fixed offset put
    the same clear patch under every place (2026-10-06). The slab's reach
    (`setCloudReach`) follows the disc, at least the default 21 km, so the
    volume reaches toward the horizon (volume-cloud plan §13, R2: the
    default ended it 21 km from the camera); disabling restores it. With
    `view` (`{ position, direction }`) and `maxAheadM`, the disc is
    centred where the view meets the deck (`cloudVolumeDiscCentre`;
    volume-cloud plan §15: the owner saw it around the camera, not where
    he looked), for the slab and its shadow, and the reach runs to the
    disc's far side; the lab passes `maxAheadM` 0 in variant 1, where the
    shell's hole is around the camera.
  - `render(camera, relief, extra = [])` (`extra`: the city, drawn into the
    depth too): after the Earth, nothing at share 0: the
    relief's depth (drawn here unless the lab already drew it this frame
    for the space pass), the slab from the lifted camera, the composite.
  - `setHex(on)` (hex-tiling plan 2026-10-07-0919, H2, the lab's
    `cloudHex=1`): the ground sky's big-shape octave hex-tiled, no repeat at
    24 km (`atmosphere.configure({ cloudHex })`, the shadow re-synced);
    idempotent; the state reports it as `hex`.
  - `patchShadow(tiles)` and `setShadow(on)` (C3): the volume's shadow on
    the relief, the framework's `CloudShadow` with the same coverage chunk
    and uniforms, the disc and the lift (`configureMap`), so it falls from
    the clouds the volume draws; patched before the haze (which is applied
    last); on only while the volume draws.
  - `state()`: `{ enabled, share, radiusM, liftM, drawn, shadow }`.
  - `coverage()` (debug, a synchronous read-back): `{ share, lowerShare,
maxAlpha }`, the share of the last volume frame's pixels its clouds
    cover (alpha over 0.05), overall and in the lower half (the view down);
    null before the first frame. The lab exposes it as
    `__globeLab.cloudVolumeCoverage()`.
  - `dispose()`.

## Invariants & assumptions

- **The relief's depth** is `globe-scene-depth.js`'s (its own meshes with
  their colour writes off: the displacement is in their vertex shader, so
  an override material would draw them flat), at most once a frame: the
  space pass reads the same texture (volume-cloud plan §17).
- **The height**: the framework's slab sits at 1.8-2.2 km; the slab is
  drawn from a copy of the camera lowered by the lift, which raises it to
  the shell's height (3 km x E). Noise, depth and distances are unchanged
  by a vertical shift. Its thickness (400 m) is not scaled with E.
- **Its own near plane** (10 m at most, the scene depth's camera): the
  depth pass and the slab are drawn from a copy of the camera with this
  near plane, never the camera's own. The camera's is fitted to the ground (0.3 x the
  clearance, 2.77 km at the 12 km hold), and the deck can be far nearer
  than the ground (3 km below the camera there): with it every view down
  clipped the deck away, and only grazing distant views kept any cloud
  (found 2026-10-06 after the owner saw no volume clouds on r777). The two
  passes share the projection because the slab reads the depth back
  through its own inverse projection.
- **The ground sky draws its sky without the slab** (it hides the slab in
  its own pass), so the clouds are drawn once, after the Earth.
- **The composite**: the slab's target holds premultiplied colour (three's
  normal blending into a cleared, alpha-0 target); the composite divides
  it back, tone-maps the straight colour and blends it by its alpha, as a
  direct draw to the canvas would.
- **Variant 1**: the shell's hole (`setHole`) has the disc's radius, both
  scaled by the share, so the clouds are drawn once at every altitude.
  **Variant 2** (the lab's default since the owner's choice of 2026-10-05)
  keeps the whole shell and draws the volume over it.
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
the hold without a console error, and its frame cost; that its clouds are
SEEN looking down from the 12 km hold over a cloudy part of the map (the
lower half's covered share, the guard for the near-plane clipping); and
its shadow against the shell's. The arithmetic is in
`GpsPlusSlamJs_Globe/src/globe-cloud-volume.test.ts`, the slab's coverage
and disc in the framework's `cloud-slab.test.ts`.
