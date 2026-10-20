/**
 * The globe's building blocks for the 3D tour editor (tour editor plan
 * 2026-10-17-1816 §13, milestone G1): the one module an app imports for
 * them (G2). Re-exports only; each block's own module and sidecar hold its
 * rules and tests.
 *
 * @see globe-editor.ts.md
 */
export {
  GLOBE_TERRAIN,
  createGlobeTerrain,
  type GlobeTerrain,
} from "./globe-terrain.js";
export {
  RELIEF_SOURCES,
  awsTerrariumRelief,
  mapterhornRelief,
  meshLevelForSpacing,
  reliefCredits,
  reliefTerrainOptions,
  vertexSpacingM,
  type GlobeReliefSource,
  type ReliefSourceConstants,
} from "./globe-relief-source.js";
export {
  RELIEF_CACHE,
  reliefCacheBudget,
  type ReliefCacheBudget,
  type ReliefCacheState,
  type ReliefDeviceClass,
} from "./globe-relief-cache.js";
export {
  drawnHeightM,
  ellipsoidalHeightM,
  type GlobeGeoid,
  type GlobeHeightPlace,
} from "./globe-heights.js";
export {
  GROUND_HIT,
  groundHit,
  groundReachM,
  marchToGround,
  terrainAboveGround,
  type GroundHit,
  type GroundHitOptions,
  type GroundHitResult,
  type GroundMiss,
  type GroundMissReason,
} from "./globe-ground-hit.js";
export {
  GLOBE_EYE,
  applyEyeControls,
  eyeClipPlanes,
  eyeNearM,
  nearestItemDistanceM,
} from "./globe-eye-camera.js";
export {
  GLOBE_OSM,
  createGlobeOsmOverlay,
  osmCredit,
  type GlobeOsmOverlay,
  type OsmCameraPose,
  type OsmOverlayTerrain,
} from "./globe-osm-overlay.js";
