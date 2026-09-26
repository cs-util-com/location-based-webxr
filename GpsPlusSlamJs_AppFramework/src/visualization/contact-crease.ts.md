# contact-crease.ts - ambient darkening at the foot of walls

- Purpose: city shadows and contact crease plan
  (`GpsPlusSlamJs_Docs/docs/2026-09-26-0549-city-shadows-and-contact-crease-plan.md`),
  M2. Buildings sit ON the ground instead of floating on it: the ambient
  light at a wall's foot is multiplied by `1 - k·exp(-h/r)`, h the metres
  above the ground. Only INDIRECT light (the sky the wall and the ground hide
  from each other); the sun is the shadow map's job. Defaults k 0.3, r 3 m
  (Mapbox GL's fake ambient occlusion). Works in WebXR (no post-process).
- Public API:
  - `CONTACT_CREASE` `{ strength: 0.3, radiusM: 3 }`.
  - `contactCreaseFactor(heightM, strength, radiusM)` - the CPU twin:
    `1 - k` at and below the base, rising to 1. `RangeError` for k outside
    [0, 1], r ≤ 0 or a NaN height.
  - `new ContactCrease({ strength?, radiusM?, baseHeightM? })`:
    - `uniforms` `{ creaseStrength, creaseRadius, creaseBase }`, bound by
      reference into every patched program;
    - `setStrength(k)` (0 switches it off), `setRadius(r)`,
      `setBaseHeight(y)` - uniforms only, never a recompile; `RangeError` on
      bad values;
    - `apply(material)` - idempotent; chains an earlier `onBeforeCompile`
      and appends `|contact-crease` to the program cache key, keeping the
      earlier identity;
    - `holds(material)` - true once this crease patched it, also under a
      hook chained later (the haze); a later PLAIN `onBeforeCompile`
      assignment drops the crease undetected, so install it first;
    - `applyToObject(root)` - patches the materials of
      every `Mesh` under `root` (not sprites, lines or points; not
      `ShaderMaterial`s), returns how many were newly patched.
- Invariants & assumptions:
  - Per FRAGMENT: walls have vertices only at the base and the top. The
    vertex shader passes the world height (instance and batching matrices
    included, so the dense city's instances crease at their own base).
  - The factor runs right after `<aomap_fragment>`, on
    `reflectedLight.indirectDiffuse` and `indirectSpecular`.
  - Missing anchors (`<common>`, `<project_vertex>`, `<aomap_fragment>`)
    throw at compile time rather than leaving an unpatched material.
  - A chaining installer that already ran this hook is detected by a marker,
    so names are never declared twice.
  - Apply it BEFORE the atmosphere haze, which chains in turn and must stay
    last.
  - The ground's height is one uniform: right on a flat page (the look-dev
    page, 0). OsmDemo (M4) needs the terrain's height under each fragment;
    the plan names `uHeightMap` for that, not built yet.
  - Never apply it to the ground itself: with the base at the ground's
    height, the whole ground would lose k of its ambient light.
- Example: `const crease = new ContactCrease(); crease.applyToObject(cityGroup); haze.applyToObject(scene);`
- Tests: `contact-crease.test.ts` (three's real ShaderLib sources: placement
  after the AO, indirect only, instancing, uniforms by reference, no
  recompile on a change, the chain and the cache key, idempotence, the haze
  after it, meshes only, a missing anchor) and `.property.test.ts` (the
  factor's range, monotonicity, base and far limits). The GPU compile and the
  pixels: the look-dev smoke test.
