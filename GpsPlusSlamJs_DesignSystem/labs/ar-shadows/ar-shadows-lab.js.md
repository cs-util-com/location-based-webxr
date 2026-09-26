# ar-shadows-lab.js - the AR shadows pixel page

- Purpose: W4 AR shadows plan (`2026-09-26-0549-ar-shadows-on-occlusion-mesh-plan.md`),
  M2. The framework's real `OcclusionMesh` receiver and `createArShadows`
  rig over a synthetic room, drawn over a stand-in camera image, with every
  probe pixel judged against the analytic oracle
  (`GpsPlusSlamJs_AppFramework/src/test-utils/shadow-oracle.ts`). It is both
  the test bench (`ar-shadows.smoke.spec.mjs`) and a page to look at on a
  phone (`/lookdev/labs/ar-shadows/` on a PR preview).
- The scene:
  - an 8 × 8 m room meshed at 10 cm and loaded through `applyMeshData`: a
    flat floor, a 1.2 m tent ridge at x = -2.9 and a 20 cm kerb from
    x = 2.2. The profile depends on x only and is linear between vertex
    columns, so every quad is planar and the triangulated mesh IS the
    analytic surface; the CPU ray solve, exact at the vertex columns, hits
    exactly what the GPU draws (a fixed-step march stepped over the ridge's
    sharp apex in the first version);
  - four casting spheres (one at the thrown-ball scale, 8 cm), three casting
    boxes (one over the kerb), one sphere that never casts, and one box
    behind the ridge that the depth-only room must hide;
  - one world-fixed directional light, a checkerboard behind an alpha
    canvas as the camera image, the fallback plane at y = 0.
- Test API, `window.__arShadowsLab`:
  - `ready`, `error`;
  - `configure({ elevationDeg, azimuthDeg, mapSize, halfWidthM, mesh,
fallback, mutation, showRoom })`: rebuilds the occluder and the rig.
    `mesh`, `fallback`, `mutation` and `showRoom` reset to true / true /
    null / false unless given, so every call states the whole
    configuration. `showRoom` draws the room with the occluder's matcap
    debug skin, for looking only. `mutation` is `'mesh-casts'`
    or `'non-caster-casts'`: the one flag that would make a non-caster cast
    (the spec's proof that its clear verdicts are not vacuous);
  - `moveCaster(index, [x, y, z])`;
  - `sample({ margins })`: renders one frame, reads the drawing buffer in
    the same task and returns `{ opacity, texelM, width, height, probes }`.
    A probe sits every 6 device pixels:
    - `target: 'caster'` when a drawn object is at least 5 cm nearer than
      the room (`casterT`, `roomT`: the two ray distances); a closer tie
      gets no probe, because the depth buffer decides it;
    - otherwise `target: 'floor'` with `flat` (flat floor at least 25 cm
      from any slope and 30 cm inside the shadow square), `kerb`,
      `behindTerrain` (a caster lies behind the room on this ray), `cls`
      (the oracle's `classifyProbe` at each margin), `terrainShadow` (deep
      in the room's own geometric shadow, oracle-outside) and
      `nonCasterShadow` (inside the non-caster's footprint,
      oracle-outside), and `q`, the world point;
    - `alpha` and `rgbMax`, the canvas bytes.
  - `lightPose()`: the rig's actual light direction next to the oracle's
    sun (they must agree).
- Invariants & assumptions:
  - The occluder takes RAW WebXR positions and applies `WEBXR_TO_NUE`
    itself, so the room is built in world coordinates and handed over
    through the inverse. Passing world positions straight in swaps the
    room's x and z, which is what the first run of this page did (the
    shadows then landed on the wrong heights).
  - A ray that enters the room's footprint below the surface sees no
    room: the mesh is an open height field with no walls.
  - Claims are about canvas alpha relative to the receiver's opacity,
    never golden images (SwiftShader differs from phones).
  - The room is probed whether or not its mesh is drawn, so "no mesh, no
    shadow" (A7) judges real floor pixels.
  - Everything is swept: the margin over 2-8 texels, the sun over four
    elevations (owner rule 2026-09-13).
- Tests: `ar-shadows.smoke.spec.mjs` (stage `test:e2e`), claims A1-A10 of
  the plan's M2, swept over margins 2-8 texels, suns 20-80 degrees and
  maps R 5/10 m × N 512-2048. Measured 2026-09-26: zero violations at
  2 texels everywhere; the spec asserts at 3.
