# stand-in-scene.js — the world the sky is judged against

- Purpose: build the look-dev page's content (owner decision DEC-SKY-7):
  a city block of extruded buildings (concrete plus a few glass towers),
  three rings of ridges at 2.5 / 5 / 9 km, two rows of material spheres
  (dielectric and metal, roughness 0…1), a lake, and three AR-diamond
  markers on poles, over a 12 km ground disc.
- Public API:
  - `buildStandInScene(scene)` → `{ ground, streets, city, dense, ridges,
swatches, lake, markers, families }`, each already added to `scene`.
  - `denseCity(pitch = 42)` → the DENSE CITY (programme plan 2026-09-26-0539,
    W1 M3): every lot of a `pitch` grid between 420 m and 2350 m (clear of the
    original scene, short of the first ridge at 2500 m), ordered by radius, as
    two InstancedMeshes (`dense-concrete` with a per-building colour,
    `dense-glass` towers). `userData`: `{ pitch, max, count, farthest,
setCount(n) }`; `setCount(n)` shows the nearest n lots (clamped), and a
    count of 0 hides the group. Starts at 0, so the default scene is
    unchanged.
  - `DENSE_PITCHES` = `[42, 31, 20]` (about 9,500, 17,500 and 42,000 lots).
- Invariants & assumptions:
  - The dense city is two draws per pass whatever the count. Its bounds are
    measured ONCE at the full allocation: three measures an InstancedMesh's
    bounding sphere the first time it is culled visible, over the count of
    that moment, and keeps it, so a sphere measured at a small count would
    cull the whole fill in any view that misses the centre.
  - Deterministic: every "random" value comes from a fixed sine hash, so
    two screenshots of one preset show the same city.
  - Units are metres, +y up, like the demos.
  - The lake is a glossy placeholder until the lightweight water material
    (plan M4). The markers' emissive orange is the design system's accent.
  - Ridges are double-sided rings with no lighting tricks: their fade into
    distance is the haze's job, which is why they are there.
- Examples: `buildStandInScene(scene).lake.material = waterMaterial;`
- Tests: indirectly by the smoke (non-uniform frames for every preset);
  the dense city directly ("the dense city fills the ring in two draws, and a
  raised count is drawn far out", whose far probe fails when the up-front
  bounds are removed, checked 2026-09-26; and "the dense city casts with
  shadows on").
