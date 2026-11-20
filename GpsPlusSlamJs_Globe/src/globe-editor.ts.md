# globe-editor.ts

- Purpose: the one module an app imports for the globe's 3D-editor
  building blocks. Re-exports only, and only what a consumer imports
  through it: the Tour Viewer's 3D editor and the globe lab
  (`/globe/globe-editor.js`). A block a consumer does not import stays
  in its own module (and its tests), off this surface.
- Public API (each block's own sidecar holds its rules):
  - The relief: `createGlobeTerrain`, `GlobeTerrain`
    (`globe-terrain.ts`: `device` (required), `imagery`, `template`,
    `tileDimension`, `cache`, `ancestorFallback`, `meshMaxLevel`,
    `reliefCache()`, `reliefFallback()`).
  - The frame: `worldFromEcefAt`, `EcefPose` (`globe-frame.ts`: the
    local world at a place, x east, y up, z south).
  - Its source: `mapterhornRelief`, `reliefCredits`,
    `reliefTerrainOptions` (`globe-relief-source.ts`) and the device
    class type `ReliefDeviceClass` (`globe-relief-cache.ts`).
  - Heights: `drawnHeightM` (`globe-heights.ts`; pass the Osm
    library's `egm96Geoid()`).
  - Picking: `groundHit`, `terrainAboveGround`, `groundReachM`,
    `groundPointOfRay`, `ellipsoidPointOfRay`, `GROUND_HIT`
    (`globe-ground-hit.ts`).
  - First person: `GLOBE_EYE` (`globe-eye-camera.ts`).
  - The OSM map: `createGlobeOsmOverlay` and the types
    `GlobeOsmOverlay`, `OsmGateLimits`, `OsmGainMode`, `OsmMapLoad`,
    `OsmMapTile`, `OsmRetryAsk`, `OsmRetryOutcome`
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
  - The package's app export (`package.json` `exports`: `./editor`), as
    TypeScript source: a Vite app depends on `gps-plus-slam-globe`
    (`workspace:*`), imports `gps-plus-slam-globe/editor`, and builds it
    (the Tour Viewer's `src/app-bundle.test.ts` builds an entry
    importing it: one three in the bundle; its `src/app-bundle.test.ts`
    then holds every third-party package it bundles named in the Tour
    Viewer's `NOTICE`, with its licence shipped).
  - A `knip` entry of the Globe workspace (root `knip.json`): the lab
    imports it by URL, which knip cannot follow, so without the entry its
    exports would read as unused. The same entry means knip never reports
    an export here as unused: before adding one, check that a consumer
    imports it through this module.
- Example:

  ```ts
  import {
    createGlobeTerrain,
    mapterhornRelief,
    reliefTerrainOptions,
    groundHit,
    drawnHeightM,
    GLOBE_EYE,
    createGlobeOsmOverlay,
  } from "gps-plus-slam-globe/editor";
  ```

- Tests: none of its own (it adds no behaviour); each block's tests, and
  the globe lab's `globe-editor-blocks.smoke.spec.mjs`, which loads it, and
  the Tour Viewer's `src/app-bundle.test.ts`, which imports and
  builds it as a dependency.
