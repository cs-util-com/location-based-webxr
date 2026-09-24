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
  - `setVisible(visible)`;
  - `dispose()` — removes the mesh from its parent, frees geometry and
    material.
- `SUN_MARKER` — the layout: rings at 0.265° (the disc), 1°, 2° and 5°;
  crosshair arms to 6° with a 0.6° gap; heading ticks at Δazimuth ±1, ±2,
  ±5; elevation ticks at ±0.5, ±1, ±2; line widths 0.1° (magenta) over
  0.25° (dark outline).

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
  order 1e6, never frustum-culled. The outline is drawn first.
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
