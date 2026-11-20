/**
 * The globe's building blocks for the 3D tour editor: the one module an
 * app imports for them. Re-exports only, and only what a consumer imports
 * through it (the Tour Viewer's editor and the globe lab); each block's
 * own module and sidecar hold its rules and tests.
 *
 * @see globe-editor.ts.md
 */
export { createGlobeTerrain, type GlobeTerrain } from "./globe-terrain.js";
export { worldFromEcefAt, type EcefPose } from "./globe-frame.js";
export {
  mapterhornRelief,
  reliefCredits,
  reliefTerrainOptions,
} from "./globe-relief-source.js";
export { type ReliefDeviceClass } from "./globe-relief-cache.js";
export { drawnHeightM } from "./globe-heights.js";
export {
  GROUND_HIT,
  groundHit,
  ellipsoidPointOfRay,
  groundPointOfRay,
  groundReachM,
  terrainAboveGround,
} from "./globe-ground-hit.js";
export { GLOBE_EYE } from "./globe-eye-camera.js";
export {
  createGlobeOsmOverlay,
  type GlobeOsmOverlay,
  type OsmGateLimits,
  type OsmGainMode,
  type OsmMapLoad,
  type OsmMapTile,
  type OsmRetryAsk,
  type OsmRetryOutcome,
} from "./globe-osm-overlay.js";
