# stand-in-scene.js — the world the sky is judged against

- Purpose: build the look-dev page's content (owner decision DEC-SKY-7):
  a city block of extruded buildings (concrete plus a few glass towers),
  three rings of ridges at 2.5 / 5 / 9 km, two rows of material spheres
  (dielectric and metal, roughness 0…1), a lake, and three AR-diamond
  markers on poles, over a 12 km ground disc.
- Public API: `buildStandInScene(scene)` → `{ ground, streets, city,
ridges, swatches, lake, markers }`, each already added to `scene`.
- Invariants & assumptions:
  - Deterministic: every "random" value comes from a fixed sine hash, so
    two screenshots of one preset show the same city.
  - Units are metres, +y up, like the demos.
  - The lake is a glossy placeholder until the lightweight water material
    (plan M4). The markers' emissive orange is the design system's accent.
  - Ridges are double-sided rings with no lighting tricks: their fade into
    distance is the haze's job, which is why they are there.
- Examples: `buildStandInScene(scene).lake.material = waterMaterial;`
- Tests: indirectly by the smoke (non-uniform frames for every preset).
