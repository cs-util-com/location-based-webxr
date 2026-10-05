# globe-cloud-shell.ts

- Purpose: the clouds on their own shell above the ground (round-6 plan
  2026-10-04-1050 G6-2, DEC-G6-3/4). Painted into the ground's colour, the
  clouds made the relief a black-and-white relief under a passing cloud and
  stuck to the ground at a flat view (owner, 2026-10-04). On the shell they
  float at a height above the relief, and the ground keeps its colour.
- Public API:
  - `createGlobeCloudShell({ uniforms, radii })` -> `GlobeCloudShell`:
    - `mesh`: a unit sphere (poles turned onto z, 256 x 128 segments, a
      facet's chord sagging about 480 m) scaled to the ellipsoid raised by
      the height on every axis; `MeshStandardMaterial` (roughness 0.9 as the
      surface's template), transparent, no depth write, both faces (read
      from above and below), drawn after the ground. Hidden until it has a
      share.
    - `setHeightM(h)`: the shell's height above the ellipsoid (m); also the
      ground shadow's offset (`uCloudShellM`). RangeError unless finite and
      > = 0.
    - `setShare(s)` / `share()`: how much of the clouds the shell draws,
      0-1, its alpha's factor; hidden at 0. RangeError outside 0-1.
    - `setHole({ radiusM, aboveCameraM } | null)` / `hole()` (volume-cloud
      plan 2026-10-05-0016, C2, variant 1): the hole the cloud volume draws
      in; the shell's clouds fade out from `radiusM` in to 0.7 of it,
      horizontally (the distance to the camera with `aboveCameraM`, the
      shell's height above the camera, taken out: `uShellHole`). RangeError
      for a radius not positive or a height not finite. The program key is
      v2 since the hole.
    - `heightM()`, `dispose()` (geometry and material).
  - RangeError for radii that are not three positive finite numbers.
- Invariants & assumptions:
  - The colour is the surface's own: the shared cloud sample and shade
    (`GLOBE_CLOUD_GLSL`) on the raised ellipsoid's geodetic normal
    (`position / radii`), the shared twilight (`GLOBE_TWILIGHT_GLSL`), and
    the surface's uniform objects (drift, opacity, look, grade, sun), so the
    two always agree. The anchors are inserted by `afterChunk`, which
    throws on a missing or repeated chunk.
  - It does not match the painted look from orbit by itself: each draw is
    tone-mapped and then blended in display space, so the shell read 25-35
    levels (summed channels) darker than the paint, and neither a colour
    gain (1-1.8) nor the opacity (0.8-1.0) closed it (measured 2026-10-04).
    So a page moves the clouds onto the shell only as far as the relief
    carries the pixels (`GlobeSurface.setCloudShellShare`; the globe lab
    uses the band's share), and the orbit keeps the paint exactly.
  - The page places it in the tiles' ECEF frame (`createGlobeSurface` holds
    it in a group that copies `tiles.group`'s matrix).
- Example:

  ```ts
  const shell = createGlobeCloudShell({ uniforms, radii: [a, a, b] });
  group.add(shell.mesh);
  shell.setHeightM(3000 * e); // 3 km x the relief's exaggeration
  shell.setShare(bandShare); // the relief's share of the pixels
  ```

- Tests: `globe-cloud-shell.test.ts` (the raised ellipsoid and its poles,
  the height's refusals, the blending flags and program key, the shared
  blocks and uniforms in the shader, the share, dispose); the surface's
  wiring in `globe-surface.test.ts`; in the browser the globe lab's
  `globe-clouds.smoke.spec.mjs` (the ground keeps its colour under the
  shell, the shadow only darkens, the orbit look unchanged).
