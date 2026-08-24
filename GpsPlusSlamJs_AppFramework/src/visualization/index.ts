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

// --- perf-stats-overlay (shared Stats.js FPS/MS/MB panel row) ---
export {
  type PerfStatsInstance,
  type PerfStatsOverlayOptions,
  type PerfStatsOverlayHandle,
  createPerfStatsOverlay,
} from './perf-stats-overlay.js';

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

// --- text-sprite ---
export {
  type TextSprite,
  type TextSpriteOptions,
  createTextSprite,
} from './text-sprite.js';

// --- wayfinding-hud (frustum-locked target indicators as camera children) ---
export {
  type WayfindingHud,
  type WayfindingHudOptions,
  DEFAULT_WAYFINDING_HUD,
  createWayfindingHud,
  validateWayfindingHudOptions,
} from './wayfinding-hud.js';

// --- wayfinding-placement (pure seam of the wayfinding HUD) ---
export {
  type TargetPlacement,
  type TargetPlacementInput,
  type TargetPlacementState,
  type ArrowPlacement,
  type CirclePlacement,
  type HiddenPlacement,
  computeTargetPlacement,
  formatDistanceLabel,
  getHudFrustumExtents,
} from './wayfinding-placement.js';

// --- three-dispose ---
export {
  type DisposeOptions,
  disposeObject3D,
  disposeMeshArray,
} from './three-dispose.js';

// --- vis-colors ---
export { VIS_COLORS } from './vis-colors.js';

// --- clamp ---
export { clamp01 } from './clamp.js';

// --- panel-geometry (UV rectangles + hit test) ---
export { type Rect, contains } from './panel-geometry.js';

// --- canvas-panel (canvas draw helpers) ---
export { toPx, roundRect } from './canvas-panel.js';

// --- billboard-math (face-the-user yaw) ---
export { type HorizontalPoint, computeBillboardYaw } from './billboard-math.js';

// --- tap-gate (tap-vs-drag predicate) ---
export { type PointerSample, isTap } from './tap-gate.js';

// --- pointer-tap-picker (tap-gated raycast picking) ---
export {
  type PointerTapPickerTargetOptions,
  createPointerTapPicker,
} from './pointer-tap-picker.js';

// --- playback-transport (pure transport reducer) ---
export {
  type TransportState,
  type TransportAction,
  INITIAL,
  transportReducer,
  isActive,
  isPlaying,
  progressFraction,
} from './playback-transport.js';

// --- panel-layout (in-world transport-panel UV layout) ---
export {
  type PanelLayout,
  type PanelTapAction,
  DEFAULT_PANEL_LAYOUT,
  hitToAction,
} from './panel-layout.js';

// --- transport-reconcile (transport-model <-> audio-element reconcile) ---
export {
  type PlayerSnapshot,
  type ReconcileCommands,
  reconcilePlayer,
} from './transport-reconcile.js';

// --- audio-player (spatialized HTMLAudioElement wrapper) ---
export { type AudioPlayer, createAudioPlayer } from './audio-player.js';

// --- transport-panel-view (in-world transport-panel canvas view) ---
export {
  type TransportPanel,
  createTransportPanel,
} from './transport-panel-view.js';

// --- billboard-interaction (billboard pointer-pick classification) ---
export { createBillboardInteraction } from './billboard-interaction.js';

// --- clickable-billboard (clickable cylindrical AR billboard) ---
export {
  type BillboardUserData,
  type ClickableBillboard,
  createClickableBillboard,
} from './clickable-billboard.js';
