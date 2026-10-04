# sky-level.ts - the sky's level for the fill light

- Purpose: the one implementation (DEC-H3) of the sky fill's level
  (DEC-GL5-11), the light the sky gives a face the sun does not reach. The
  globe's surface patch (`globe-surface-material.ts`, and through it the
  relief's tiles in `globe-terrain.ts`) and the terrain lab
  (`labs/terrain/terrain-sun.js`, which re-exports it) both read it, so at
  a low sun the relief and the globe's flat ground get the same fill.
- Public API:
  - `SKY_FILL` - frozen `{ floor: 0.5, twilightDeg: 6 }`. `floor` is in
    the units of open flat ground under a zenith sun (the terrain lab's
    measured choice: at an 11 degree sun on the Alps it lifts the darkest
    tenth of `globe-albedo` above 10 of 255); `twilightDeg` is civil
    twilight.
  - `skyLevel(sunZ, floor = SKY_FILL.floor, twilightDeg = SKY_FILL.twilightDeg)`
    - `sunZ` is the sine of the sun's elevation. Returns
      `max(max(0, sunZ), floor x smoothstep(-sin(twilightDeg), 0, sunZ))`:
      the sun's height above the floor, the floor while the sun is low, the
      floor faded to 0 through the twilight below the horizon. RangeError
      for a non-finite height, a floor outside 0-1 or a twilight outside
      0-90 degrees (exclusive).
  - `SKY_LEVEL_GLSL` - the shader's copy, `float skyLevelOf( float sunZ,
float floorLevel )`, the twilight's sine baked from `SKY_FILL` to 8
    decimals; the floor is each shader's own uniform (`uSkyFloor`).
- Invariants & assumptions:
  - Never falls as the sun rises (a property test).
  - Type-erasable, so node's own runner loads the TypeScript source
    directly: the design system's `test-route-loader.mjs` maps
    `/globe/sky-level.js` to it, and its sibling `./globe-ease.js` (whose
    smoothstep it uses, the package's one) to `globe-ease.ts`.
  - Its whole relative import graph reaches no bare module: pages without
    an import map load it (the terrain lab's colour comparison page). It
    once read smoothstep from `globe-camera.ts`, which imports "three", and
    that page never started (r766 milestone run, 2026-10-04); a test walks
    the graph.
- Examples:
  - `skyLevel(Math.sin(11.2 * Math.PI / 180))` is 0.5 (the floor);
    `skyLevel(1)` is 1; `skyLevel(-Math.sin(6 * Math.PI / 180))` is 0.
- Tests: `sky-level.test.ts` (the values, the twilight fade, monotonic,
  the refusals, the GLSL's baked twilight); the terrain lab's
  `terrain-sun.test.mjs` checks that it re-exports these same objects and
  that the globe's surface material imports this module;
  `globe-surface-material.test.ts` checks the patch carries
  `SKY_LEVEL_GLSL` once.
