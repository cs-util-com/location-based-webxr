/**
 * Visualization module — Three.js markers, Leaflet map overlay, alignment lerping, camera follower.
 */

// --- alignment-lerper ---
export {
  type AlignmentLerper,
  createAlignmentLerper,
} from './alignment-lerper.js';

// --- ar-world-group-alignment ---
export {
  type ArWorldGroupAlignmentOptions,
  type ArWorldGroupAlignmentHandle,
  enableArWorldGroupAlignment,
} from './ar-world-group-alignment.js';

// --- camera-follower ---
export {
  type CameraFollower,
  createCameraFollower,
} from './camera-follower.js';

// --- css3d-renderer-manager ---
export {
  type Css3dRendererManager,
  createCss3dRendererManager,
} from './css3d-renderer-manager.js';

// --- gps-compass-cubes ---
export {
  COMPASS_CUBE_SIZE,
  COMPASS_CUBE_DISTANCE,
  type GpsCompassCubes,
  createGpsCompassCubes,
} from './gps-compass-cubes.js';

// --- frustum-visibility ---
export {
  buildCameraFrustum,
  isObjectInCameraFrustum,
  isPointInCameraFrustum,
  isSphereInCameraFrustum,
} from './frustum-visibility.js';

// --- frame-conversions ---
export { nueToArLocal, worldNueToGps } from './frame-conversions.js';

// --- hit-test-reticle ---
export {
  type HitMatrix,
  createReticleMesh,
  updateReticle,
} from './hit-test-reticle.js';

// --- gps-anchor ---
export {
  type GpsAnchor,
  type GpsAnchorMode,
  type GpsAnchorOptions,
  type GpsAnchorPhase,
  type GpsAnchorSamplePoint,
  createGpsAnchor,
} from './gps-anchor.js';

// --- gps-event-markers ---
export { GpsEventVisualizer, gpsEventVisualizer } from './gps-event-markers.js';

// --- occlusion-mesh (persistent depth-only occluder of the occupancy grid) ---
export {
  type OcclusionMeshOptions,
  type OccluderDebugStyle,
  OCCLUDER_DEBUG_STYLES,
  OcclusionMesh,
} from './occlusion-mesh.js';

// --- occupancy-cubes-visualizer (instanced debug cubes of the occupancy grid) ---
export {
  type OccupancyGridSource,
  type ViewerPose,
  type OccupancyCubesVisualizerOptions,
  OccupancyCubesVisualizer,
  pickNearestSubset,
} from './occupancy-cubes-visualizer.js';

// --- leaflet-map-overlay ---
export {
  DEFAULT_LEAFLET_MAP_SIZE_PX,
  DEFAULT_WORLD_SIZE,
  DEFAULT_Z_OFFSET,
  type LeafletMapOverlayOptions,
  LeafletMapOverlay,
} from './leaflet-map-overlay.js';

// --- lerp-utils ---
export { DEFAULT_LERP_RATE, clampedAlpha } from './lerp-utils.js';

// --- map-data (shared trajectory model) ---
export { type MapData, type MapDataInput, buildMapData } from './map-data.js';

// --- pointer-picking (engine-free desktop raycast helper) ---
export {
  type Ndc,
  type ElementRect,
  pointerToNdc,
  raycastPointer,
  pickWorldPoint,
} from './pointer-picking.js';

// --- accuracy-circles (shared per-event GPS accuracy circles) ---
export {
  type AccuracyCircleSample,
  ACCURACY_CIRCLE_FILL_OPACITY,
  ACCURACY_CIRCLE_STROKE_OPACITY,
  ACCURACY_CIRCLE_WEIGHT,
  addAccuracyCircles,
} from './accuracy-circles.js';

// --- map-overlay-draw (shared trajectory drawing routine) ---
export {
  type DrawMapDataOptions,
  type DrawnMapData,
  RAW_GPS_COLOR,
  FUSED_PATH_COLOR,
  ALIGNMENT_SNAPSHOT_COLOR,
  USER_POSITION_COLOR,
  MAP_PATH_POLYLINE_WEIGHT,
  MAP_PATH_POLYLINE_OPACITY,
  drawMapData,
} from './map-overlay-draw.js';

// --- three-dispose ---
export {
  type DisposeOptions,
  disposeObject3D,
  disposeMeshArray,
} from './three-dispose.js';

// --- vis-colors ---
export { VIS_COLORS } from './vis-colors.js';
