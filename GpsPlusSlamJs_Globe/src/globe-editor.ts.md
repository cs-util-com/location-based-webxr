# globe-editor.ts

- Purpose: the one module an app imports for the globe's 3D-editor
  building blocks (tour editor plan
  `2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md` §13,
  milestone G1, for G2). Re-exports only.
- Public API (each block's own sidecar holds its rules):
  - The relief: `createGlobeTerrain`, `GLOBE_TERRAIN`, `GlobeTerrain`
    (`globe-terrain.ts`: `device` (required), `tileDimension`, `cache`,
    `ancestorFallback`,
    `meshMaxLevel`, `reliefCache()`, `reliefFallback()`).
  - Its sources: `RELIEF_SOURCES`, `awsTerrariumRelief`,
    `mapterhornRelief`, `reliefCredits`, `reliefTerrainOptions`,
    `vertexSpacingM`, `meshLevelForSpacing` (`globe-relief-source.ts`).
  - Its cache: `RELIEF_CACHE`, `reliefCacheBudget` and the state types
    (`globe-relief-cache.ts`).
  - Heights: `drawnHeightM`, `ellipsoidalHeightM` (`globe-heights.ts`;
    pass the Osm library's `egm96Geoid()`).
  - Picking: `groundHit`, `marchToGround`, `terrainAboveGround`,
    `groundReachM`, `GROUND_HIT` and the types `GroundHit`, `GroundMiss`,
    `GroundMissReason`, `GroundHitResult`, `GroundHitOptions`
    (`globe-ground-hit.ts`).
  - First person: `GLOBE_EYE`, `eyeNearM`, `eyeClipPlanes`,
    `nearestItemDistanceM`, `applyEyeControls` (`globe-eye-camera.ts`).
  - The OSM map: `createGlobeOsmOverlay`, `GLOBE_OSM`, `osmCredit`, the
    types `GlobeOsmOverlay`, `OsmCameraPose`, `OsmOverlayTerrain`
    (`globe-osm-overlay.ts`; pass the framework's `osm-tiles.ts`
    constants; it draws only where the relief reaches z15, so with the
    denser mesh).
- Invariants & assumptions:
  - Nothing here but re-exports: no state, no side effects, so importing
    it costs only the modules it names.
  - Served no-build like every Globe module (`/globe/globe-editor.js` in
    the design system's dev server, types stripped); the globe lab imports
    the first-person, picking and OSM blocks through it, which is what
    proves the entry loads in a browser.
  - The package's one export (`package.json` `exports`: `./editor`), as
    TypeScript source: a Vite app depends on `gps-plus-slam-globe`
    (`workspace:*`), imports `gps-plus-slam-globe/editor`, and builds it
    (the Tour Viewer's `src/globe-dependency.test.ts` builds an entry
    importing it: one three in the bundle, every third-party package it
    bundles named in the Tour Viewer's `NOTICE`).
  - A `knip` entry of the Globe workspace (root `knip.json`): the lab
    imports it by URL, which knip cannot follow, so without the entry its
    exports would read as unused.
- Example (G2):

  ```ts
  import {
    createGlobeTerrain,
    mapterhornRelief,
    awsTerrariumRelief,
    reliefTerrainOptions,
    reliefCacheBudget,
    groundHit,
    drawnHeightM,
    GLOBE_EYE,
    applyEyeControls,
    eyeClipPlanes,
    createGlobeOsmOverlay,
  } from "gps-plus-slam-globe/editor";
  ```

- Tests: none of its own (it adds no behaviour); each block's tests, and
  the globe lab's `globe-editor-blocks.smoke.spec.mjs`, which loads it, and
  the Tour Viewer's `src/globe-dependency.test.ts`, which imports and
  builds it as a dependency.
