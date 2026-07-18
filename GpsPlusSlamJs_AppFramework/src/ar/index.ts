/**
 * AR module — WebXR session management, scene hierarchy, image/depth capture,
 * and QR detection/pose (the `qr/` subdirectory, re-exported below).
 */

// --- ar-crash-isolation (XR session-negotiation diagnostic flags) ---
export {
  type ArCrashIsolationOptions,
  DEFAULT_AR_CRASH_ISOLATION,
  validateArCrashIsolationOptions,
} from './ar-crash-isolation.js';

// --- camera-blit-capture ---
export {
  type CameraBlitCaptureConfig,
  DEFAULT_BLIT_CONFIG,
  computeCaptureSize,
  computeAspectFitSize,
  CameraBlitCapture,
} from './camera-blit-capture.js';

// --- capability-checker ---
export {
  type CapabilitySupport,
  type CapabilityMessageOptions,
  isFullySupported,
  capabilityMessage,
} from './capability-checker.js';

// --- chromium-camera-access-workaround ---
export {
  type ChromiumProjectionLayerWorkaroundResult,
  type ChromeVersion,
  BASELAYER_WINDOW_MIN,
  BASELAYER_WINDOW_MAX,
  applyChromiumProjectionLayerWorkaround,
  parseChromeVersion,
  needsBaseLayerPersistence,
} from './chromium-camera-access-workaround.js';

// --- capture-failure-tracker ---
export {
  type CaptureFailureTrackerConfig,
  DEFAULT_CAPTURE_TRACKER_CONFIG,
  CAPTURE_FAILURE_WARNING,
  type CaptureFailureTracker,
  createCaptureFailureTracker,
} from './capture-failure-tracker.js';

// --- depth-sampler ---
export {
  type DepthSamplerConfig,
  type DepthSamplerCallbacks,
  type DepthInfo,
  DepthSampler,
  wrapXRDepthInfo,
} from './depth-sampler.js';

// --- depth-unprojection ---
export {
  unprojectDepthPoint,
  createDepthUnprojector,
  type DepthUnprojector,
} from './depth-unprojection.js';

// --- depth-grid-lookup ---
export {
  createDepthGridLookup,
  type DepthGridLookup,
} from './depth-grid-lookup.js';

// --- qr/ (QR detection, pose, size-from-depth, aggregation, GPS vote,
// planar-pnp, detection-scheduler) — the whole sub-barrel is re-exported so
// barrel consumers are unaffected by the ar/qr/ namespace split. ---
export * from './qr/index.js';

// --- camera-frame-source (B2 — generic throttled RGBA feed for CV) ---
export {
  type CameraFrameSourceConfig,
  type CameraFrameSourceCallbacks,
  CameraFrameSource,
} from './camera-frame-source.js';

// --- bresenham3d ---
export { bresenham3d, type GridCell } from './bresenham3d.js';

// --- occupancy-grid ---
export { OccupancyGrid, type OccupancyGridOptions } from './occupancy-grid.js';

// --- occupancy-mesher (sparse voxel Set → face-culled surface + AABB list) ---
export {
  type Aabb,
  type OccupancyMeshResult,
  type MeshOccupiedCellsOptions,
  meshOccupiedCells,
} from './occupancy-mesher.js';

// --- frame-loop ---
export { type FrameUpdate, registerFrameUpdate } from './frame-loop.js';

// --- xr-frame-loop ---
export {
  type XrFrameContext,
  type XrFrameUpdate,
  registerXrFrameUpdate,
} from './xr-frame-loop.js';

// --- hit-test-reticle-driver ---
export {
  type HitTestReticleHandle,
  type HitTestReticleArgs,
  startHitTestReticle,
} from './hit-test-reticle-driver.js';

// --- enable-gps-ar ---
export {
  type EnableGpsArStatus,
  type EnableGpsArState,
  type EnableGpsArConfig,
  type EnableGpsArResult,
  type EnableGpsArDeps,
  type EnableGpsArController,
  createEnableGpsArController,
} from './enable-gps-ar.js';

// --- image-quality (pure blur/blackness metrics + drop/retry verdict policy) ---
export {
  type QualityFilterConfig,
  type BlurMetricId,
  BLUR_METRIC_IDS,
  DEFAULT_QUALITY_FILTER,
  DEFAULT_SHARPNESS_HISTORY_SIZE,
  DEFAULT_SHARPNESS_MIN_SAMPLES,
  type QualityRejectReason,
  type QualityVerdict,
  sharpnessScore,
  highFrequencyEnergyRatio,
  blurMetricScorer,
  rgbaToGrayscale,
  meanLuminance,
  ImageQualityGate,
} from './image-quality.js';

// --- image-capture ---
export {
  MIN_VALID_IMAGE_BYTES,
  type ImageCaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
  type CapturedImage,
  type CapturedFrame,
  type FrameQualityVerdict,
  type ImageCaptureCallbacks,
  ImageCaptureManager,
} from './image-capture.js';

// --- replay-scene ---
export {
  type CameraMode,
  type ReplaySceneState,
  initReplayScene,
  disposeReplayScene,
  getReplayState,
  updateOrbitTarget,
  getCameraMode,
  getCameraFollower,
  getAlignmentLerper,
  toggleCameraMode,
} from './replay-scene.js';

// --- scene-node-names ---
export { SCENE_NODE } from './scene-node-names.js';

// --- webxr-session ---
export {
  initAR,
  endARSession,
  type ArSessionCallbacks,
  type SessionEndInfo,
  rebindTrackingStore,
  startImageCapture,
  stopImageCapture,
  getImageCaptureFrameCount,
  startDepthCapture,
  stopDepthCapture,
  getDepthSampleCount,
  startCameraFrameCapture,
  stopCameraFrameCapture,
  getCameraFrameCount,
  type CameraFrameCaptureConfig,
  getScene,
  getArWorldGroup,
  getCamera,
  getCurrentArPose,
  getDepthInfoFromFrame,
  type SessionFeatureOptions,
} from './webxr-session.js';

// --- webxr-nue-basis ---
export { WEBXR_TO_NUE } from './webxr-nue-basis.js';

// --- xr-camera-texture ---
export {
  type CameraTextureResult,
  type XRCameraLike,
  type RendererLike,
  acquireCameraTexture,
} from './xr-camera-texture.js';

// --- xr-error-handler ---
export {
  XR_ERROR_MESSAGES,
  XR_ERROR_MESSAGE_UNKNOWN,
  getXrErrorMessage,
} from './xr-error-handler.js';
