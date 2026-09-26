# ar-shadows.ts - AR shadows on the reconstructed room

- Purpose: virtual objects cast shadows onto the real room in AR (W4 AR
  shadows plan 2026-09-26-0549; DEC-W4-1/2; programme DEC-PRG-6). It drives
  one world-fixed casting light through the sun-shadow rig and makes the
  current `OcclusionMesh` receive, AUTOMATICALLY, whenever the renderer's
  shadow map is on and a light casts. A flat fallback plane receives while
  there is no mesh.
- Public API:
  - `AR_SHADOWS`: the defaults: half width R 5 m and map size N 1024 (about
    1 cm texels), and the rig's display opacity (about 0.42). R and N stay
    provisional until the M2 sweep.
  - `shadowReception(renderer, lights)` → `{ active: true }` or
    `{ active: false, reason }`, with reasons `'shadow-map-off'`,
    `'vsm-unsupported'` (under VSM three draws receivers into the map, so
    the mesh would shadow itself) and `'no-casting-light'`.
  - `createArShadows({ renderer, light, getOccluder, fallbackPlane?,
opacity?, halfWidthM?, mapSize?, dynamicCasters? })` → `ArShadows`:
    - `update({ ..., centre, casterCount })` re-evaluates the rule, gives
      the receiver to the current occluder (or shows the fallback plane when
      there is none), and drives the rig. With `dynamicCasters` (the thrown
      balls), the map re-renders every frame while casters exist, plus one
      last time when the last one goes, so no shadow lingers.
    - `setEnabled(on)` is the session switch: the light's shadow intensity
      goes to 0 (no recompile) and `autoUpdate` to false (intensity 0 alone
      does not stop the shadow pass).
    - `isActive()`, `receiverOptions()` and `dispose()`, which restores the
      light's intensity and hides the receivers.
- Invariants & assumptions:
  - The occluder is looked up on every update (`getOccluder`), because
    PhysicsDemo recreates the mesh on every mesh-mode change.
  - A remesh never re-renders the map: the mesh only receives.
  - While inactive, the map is not rendered at all.
  - The light must be world-fixed and expressed in the room's frame.
    `SUN_LIGHT` sits in the scene root while the room hangs under
    `arWorldGroup`, so a heading correction would swing the shadow (W4 plan
    §8, a frame decision for the PhysicsDemo integration).
- Example:
  `const shadows = createArShadows({ renderer, light, getOccluder: () => view.getOcclusionMesh(), dynamicCasters: true });`
  then `shadows.update({ centre, casterCount: balls.length })` each frame.
- Tests: `ar-shadows.test.ts` covers:
  - the automatic rule with each reason;
  - the receiver moving to a recreated mesh;
  - the fallback plane taking over;
  - the dynamic re-render and its last render;
  - `setEnabled(false)` stopping `autoUpdate` at once;
  - `dispose` restoring the light.

  The analytic oracle that the pixel page (M2) checks against is
  `test-utils/shadow-oracle.ts` (test-only, off the barrels).
