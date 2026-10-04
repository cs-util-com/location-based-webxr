# cloud-sheet.ts

## Purpose

The fly-through cloud SHEET (plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-1010-lookdev-fly-through-cloud-layer-plan.md`,
owner decision DEC-SUN-16). It puts the dome layer's clouds on real geometry:
a horizontal disc 2 km up. A camera can then fly up to it, dissolve through
it, and look down on it, which the sky-dome layer (`cloud-layer.ts`, drawn at
infinity behind everything) cannot do. `SkyAtmosphere` owns the mesh and adds
it only in `cloudMode: 'sheet'`. The default `'dome'` changes nothing for
existing callers.

## Public API

- `CLOUD_SHEET`: the constants, in metres (the scene's unit).
  - `altitudeM` (2000).
  - `radiusM` (24 km).
  - The near fade (60 → 400 m) and the far fade (14 → 21 km horizontal).
  - The ring mesh: `innerRadiusM` 2, `ringRatio` 1.25, `sectors` 48.
  - `topAlbedo` (0.8).
- `CLOUD_MODES` / `CloudMode`: `'dome' | 'sheet' | 'slab'` (the slab is
  [`cloud-slab.ts`](cloud-slab.ts.md); `SkyAtmosphere` picks the mesh).
- `cloudSheetFade(distanceM, horizontalM)`: the opacity factor from the
  camera (CPU twin of the shader's `fade`). `RangeError` for a distance that
  is negative or not finite, or for a horizontal distance larger than the
  distance.
- `cloudSheetRenderOrder(cameraY)`: -1 below the sheet, +1 above it.
- `cloudTopRadiance(sunT, sunY, zenith)`: a cloud top seen from above (CPU
  twin of `atmCloudTopLit`).
- `CLOUD_TOP_LIT_GLSL`: `atmCloudTopLit` itself, included by the sheet and
  the slab, so both draw one sunlit top.
- `cloudSheetRingRadii()`: the disc's ring radii.
- `CLOUD_SHEET_FRAGMENT_GLSL` (the vertex shader is module-private).
- `createCloudSheet(uniforms)`: the mesh. It reads the uniform objects it is
  given, so the SAME objects as the sky are shared, not copies.

## Invariants & assumptions

- **One pattern, one cover.** The shader includes `ATMOSPHERE_CLOUD_GLSL`,
  the chunk the dome's `atmClouds` uses: the same texture, octaves,
  threshold, soft step and underside light. The noise is sampled at the
  fragment's WORLD x/z, so the pattern stays put when the mesh re-centres.
  From the ground, it is the dome's pattern shifted by the camera's position.
- **Follows the camera.** `onBeforeRender` moves the mesh to the rendering
  camera's x/z. three computes the model-view matrix after that hook, so the
  move lands in the same frame. `frustumCulled` is false.
- **Occlusion is the depth test's.** Depth test on, depth write off,
  `DoubleSide`, transparent. From below, a building in front hides the
  sheet; from above, the sheet covers the city.
  - **Assumption:** no scene geometry reaches the sheet's altitude. The
    look-dev scene tops out at 520 m (unit-tested). Any adoption must
    re-check its own scene.
- **Draw order.** Transparent objects sort by renderOrder first, and sprites
  write depth.
  - The sheet draws before them while the camera is below it, and after them
    while above.
  - The order is set in the hook, so it takes effect one frame late. That is
    invisible, because the near fade has the sheet transparent at the
    crossing.
- **Fades.**
  - **Near (3D distance):** zooming through is a dissolve. The e2e measures
    the frame converging on the sheet-free frame as the camera reaches the
    sheet from both sides: 0.00 at 0.5 m and 2 m, 163 at 200 m above and
    37 at 200 m below.
  - **Far (horizontal distance):** ends inside the disc, so its edge never
    shows. The e2e reads the sheet's contribution below the fade's end
    elevation: 0 at all four covers, where a hard cut at the edge reads 8-13.
  - **Aerial:** the dome's `exp(-t/60 km)`, applied as alpha. From above,
    distant ground therefore shows through instead of haze (a known
    limitation).
- **Light.**
  - Seen from below (`dir.y ≥ 0`): the dome's underside model.
  - Seen from above: the sunlit TOP, `sunT · sun.y · topAlbedo / π` (the sky
    shader's ground-term form), plus the sky ambient.
  - Why: the dome's model alone drew the deck from above a dull grey
    (measured: 111/116/132 → 233/229/228 with the top term, noon, cover 0.9).
- **Mesh: rings, not a grid.** Triangles grow with their distance from the
  camera.
  - A uniform grid of 1.5 km triangles broke with the eye 0.5 m above the
    sheet. Every fragment of the triangle under the camera got ONE
    interpolated world position (measured with a debug output in the
    look-dev page), so the near fade saw one distance and the sheet drew
    solid white.
  - The first version, one 48 km quad of two triangles, lost a whole
    triangle when seen from above.
- **Colour space.** The output is tone-mapped and encoded like the sky box,
  then blended, so on the canvas the sheet blends in display space. Soft
  edges differ slightly from the dome's linear mix, and no test expects
  dome-to-sheet pixel equality.
- **Not modelled:** thickness (flying through is a dissolve, not a
  whiteout). The sky and the haze stay those of the fixed 0.2 km observer,
  so from 3 km the sky above is the ground-level sky. The volume is the
  plan's conditional M2.

## Example

```ts
const sky = new SkyAtmosphere({ renderer, scene });
sky.configure({ sunDirection, cloudCover: 0.5, cloudMode: 'sheet' });
// SkyAtmosphere adds the sheet to `scene`; nothing else to wire.
```

## Tests

- `cloud-sheet.test.ts`:
  - the constants' ordering (the far fade ends inside the disc);
  - the fade's values and monotonicity, and a property over camera heights
    0-4 km and every ray;
  - the visibility from above;
  - the refusals;
  - the render order;
  - the re-centring hook;
  - the material flags;
  - the rings;
  - the top radiance;
  - the constants injected into the shader.
- `sky-atmosphere.test.ts`: the mode switch (see that sidecar).
- `atmosphere-glsl.test.ts`: the sheet's shader defines only `atm`-prefixed
  functions.
- The look-dev smoke (`GpsPlusSlamJs_DesignSystem/3d/lookdev.smoke.spec.mjs`)
  is the only GPU check:
  - covering the city from above;
  - the ground hiding the sheet;
  - no clouds from the sky itself in sheet mode;
  - the crossing;
  - the far edge.
  - Every threshold is declared there with its measurement.
