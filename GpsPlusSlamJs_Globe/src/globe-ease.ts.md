# globe-ease.ts

- Purpose: the Globe package's one easing curve (`smoothstep`), in a module
  with no imports at all.
- Why it is its own file: `sky-level.ts` uses it, and the terrain lab's
  colour comparison page loads `sky-level.ts` (through the lab's
  `terrain-sun.js`) without an import map. While the curve lived in
  `globe-camera.ts`, which imports "three", that page failed to resolve
  "three" and never started (r766 milestone run, 2026-10-04).
- Public API: `smoothstep(t)` -> the Hermite ease `x * x * (3 - 2x)` of `t`
  clamped to [0, 1]. `globe-camera.ts` re-exports it, so its existing
  importers are unchanged. One copy per package (the duplicate-helper
  guard's `perPackage` rule).
- Invariants: no imports, ever; `sky-level.test.ts` walks the sky level's
  relative imports and fails on any bare one.
- Tests: `globe-camera.test.ts` (the curve itself, through the re-export)
  and `sky-level.test.ts` (no bare import reachable from the sky level).
