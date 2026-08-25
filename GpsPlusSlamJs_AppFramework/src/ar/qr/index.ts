/**
 * QR module — QR detection, pose solving (pure-JS planar PnP), size-from-depth
 * measurement, pose aggregation/stability, GPS voting, and detection scheduling.
 *
 * Sub-barrel of `ar/` for direct namespace imports
 * (`gps-plus-slam-app-framework/ar/qr`). The parent `ar/` barrel re-exports
 * everything here, so existing barrel consumers are unaffected.
 */

// --- qr-size-from-depth (Note 4 — measure the QR size from the depth map) ---
export {
  type QrSizeStatus,
  type QrSizeEstimate,
  type QrSizeObservation,
  type QrSizeAccumulatorOptions,
  type QrSizeAccumulator,
  estimateQrSizeFromDepth,
  createQrSizeAccumulator,
} from './qr-size-from-depth.js';

// --- qr-size-measurer (Part B — shared depth→size piece) ---
export {
  type QrSizeDepthContext,
  type ImageSize,
  type QrSizeMeasurement,
  type QrSizeMeasurer,
  createQrSizeMeasurer,
} from './qr-size-measurer.js';

// --- qr-size-depth-context (shared DepthSample → QrSizeDepthContext factory) ---
export { createQrSizeDepthContext } from './qr-size-depth-context.js';

// --- qr-pose ---
export {
  type Point2,
  type CameraIntrinsics,
  type Pose,
  type OpenCvPnpResult,
  type SolvePnpSquare,
  type SolveQrPoseInput,
  type QrPoseSolution,
  type QuadValidation,
  buildObjectPoints,
  intrinsicsFromProjection,
  projectViewPoint,
  qrInCameraFromOpenCv,
  composePose,
  invertPose,
  transformPoint,
  rotateVectorByQuaternion,
  signedQuadArea,
  validateQuad,
  reprojectionErrorPx,
  solveQrPose,
} from './qr-pose.js';

// --- qr-derived-pose (decision D-A — derive size/pose from RAW on read) ---
export {
  type RawQrObservation,
  type DeriveQrPoseDeps,
  type DerivedQrPlacement,
  type IncrementalQrPlacement,
  deriveQrSizeM,
  solveQrPoseFromObservation,
  deriveSolvedQrPose,
  deriveQrPlacement,
  createIncrementalQrPlacement,
} from './qr-derived-pose.js';

// --- qr-debug-view (shared 3D debug axis+cube consumer, WS-5) ---
export { createQrDebugView, type QrDebugView } from './qr-debug-view.js';

// --- qr-detection-controller (the thin geo-less RAW producer, D-X) ---
export {
  type QrScanStatus,
  type RawObservationSink,
  type QrDetectionControllerDeps,
  type QrDetectionController,
  createQrDetectionController,
} from './qr-detection-controller.js';

// --- qr-pose-aggregation (sliding-window pose stabilization) ---
export {
  DEFAULT_ROTATION_INLIER_ANGLE_DEG,
  type AverageRotationOptions,
  type AverageRotationResult,
  type AggregateQrPoseResult,
  type QrPoseStabilityStatus,
  type QrPoseStabilityOptions,
  type QrPoseStability,
  averageRotation,
  aggregateQrPose,
  evaluateQrPoseStability,
} from './qr-pose-aggregation.js';

// --- qr-level ---
export {
  type QrLevel,
  type FetchLike,
  type FetchQrLevelOptions,
  QrLevelValidationError,
  parseQrLevel,
  serializeQrLevel,
  fetchQrLevel,
} from './qr-level.js';

// --- qr-tracking-controller ---
export {
  type QrTrackingStatus,
  type QrSolvePoseInput,
  type QrDetectionEvent,
  type QrTrackingControllerConfig,
  type QrTrackingController,
  createQrTrackingController,
} from './qr-tracking-controller.js';

// --- qr-frontend ---
export {
  type RgbaImage,
  type QrDetection,
  type QrFrontEnd,
  type DetectedBarcodeLike,
  type BarcodeDetectorLike,
  type ToImageBitmapSource,
  BarcodeDetectorFrontEnd,
  createBarcodeDetectorFrontEnd,
} from './qr-frontend.js';

// --- planar-pnp (pure-JS IPPE; the OpenCV-free SolvePnpSquare) ---
export {
  type Mat3,
  type Homography,
  type PoseCandidate,
  solveLinear,
  homographyFromCorrespondences,
  nearestRotation3x3,
  ippePoseCandidates,
  rotationToRodrigues,
  PlanarPnpSquare,
} from './planar-pnp.js';

// --- detection-scheduler (generic; QR aliases kept for back-compat) ---
export {
  type DetectionSchedulerConfig,
  type DetectionScheduler,
  type QrDetectionSchedulerConfig,
  type QrDetectionScheduler,
  createDetectionScheduler,
  createQrDetectionScheduler,
} from './detection-scheduler.js';

// --- qr-gps-vote ---
export {
  type QrGeoPose,
  type QrGpsVoteInput,
  type Enu,
  localPlaneToEnu,
  localPlaneOffset,
  offsetGeo,
  buildQrGpsVotes,
} from './qr-gps-vote.js';

// --- qr-geo-pose-minting ---
export {
  type MintQrGeoPoseInput,
  mintQrGeoPose,
} from './qr-geo-pose-minting.js';

// --- qr-occupancy-check ---
export {
  type OccupancySurface,
  type QrPlausibilityVerdict,
  type QrPlausibility,
  type QrPlausibilityOptions,
  checkQrPlausibility,
} from './qr-occupancy-check.js';
