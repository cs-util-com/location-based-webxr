# `ar/sun-marker.ts`

## Purpose

A virtual sun drawn over the real one, with a heading scale, so the AR
alignment's heading error can be read by eye (plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-0100-ar-sun-overlay-heading-check-plan.md`,
M2, §3.3). Owns no clock and no store; `ar/sun-check.ts` drives it.

## Public API

- `createSunMarker()` → `SunMarker`:
  - `object` — the `THREE.Mesh`; add it to the scene ROOT (the GPS-world NUE
    frame);
  - `setSun(azimuthDeg, elevationDeg)` — point it at the (apparent) sun;
    `RangeError` for non-finite angles or |elevation| > 90°;
  - `reticle` — the screen-centre crosshair (clip space, fixed at NDC
    (0, 0), the pixel a Mark measures; add it to the scene too);
  - `setVisible(visible)` — marker and reticle together;
  - `dispose()` — removes the mesh from its parent, frees geometry and
    material.
- `SUN_MARKER` — the layout: rings at 0.265° (the disc), 1°, 2° and 5°;
  crosshair arms to 6° with a 0.6° gap; heading ticks at Δazimuth ±1, ±2,
  ±5; elevation ticks at ±0.5 and ±1.5 (between the rings: at ±1 and ±2
  they were hidden under the rings' outlines); line widths 0.1° (magenta)
  over 0.25° (dark outline); the reticle in NDC (gap 0.012, reach 0.05),
  white over the dark outline.

## Invariants & assumptions

- **Direction-only**: the vertex shader places each vertex with
  `projectionMatrix * vec4(mat3(viewMatrix) * d, 1)`, like the sky: no lag,
  no parallax, right for each XR view, never clipped by the far plane.
- **Angles, not metres**: each vertex carries `sunOffset` = (Δazimuth, u, v)
  in degrees; the shader is the twin of `markerVertexDirection` in
  `ar/sun-check-geometry.ts` (heading ticks on the almucantar, the corrected
  tangent basis). Rings are built at their TRUE angular radius (gnomonic
  radius tan r), so they read as distances.
- **Over everything, ungraded**: no depth test or write, no fog, no tone
  mapping (OsmDemo's Khronos Neutral grade cannot shift the colour), render
  order 1e6, never frustum-culled. **One pass** (`forceSinglePass`): a
  transparent DoubleSide material otherwise draws back faces first, and the
  line quads face away, so the ring outlines covered the arms and ticks (M2
  review finding 2). The outline is drawn first, the colour over it.
- **Depth 0 in clip space**: neither the near nor the far plane can clip a
  direction in front of the camera (at OsmDemo's AR near 0.5, the plain
  1 m placement clipped anything beyond 60° off-axis).
- Tick labels are not drawn yet (a text atlas, plan §3.3).

## Examples

```ts
const marker = createSunMarker();
scene.add(marker.object);
marker.setSun(sunAzDeg, sunElApparentDeg);
```

## Tests

`sun-marker.test.ts`: the rings at their true radius and the heading ticks
at azimuth a + N (through the JS twin), the outline-then-colour order, the
rotation-only shader (structural), the material flags, the handle
(uniforms, visibility, range errors) and disposal. The pixel test with a
real GPU path is the OsmDemo milestone's (plan §8.3).
