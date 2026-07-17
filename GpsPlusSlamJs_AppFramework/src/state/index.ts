/**
 * State module — Combined store factory, recording coordinator, replay engine, store subscribers.
 */

// --- recording-slice (recorder session state, lives in framework so persistence
//     middleware can read it; the store factory itself is in the recorder app). ---
export {
  type RecordingState,
  type SessionMetadata,
  startSession,
  endSession,
  recordDepthSample,
  recordWriteFailure,
  recordingReducer,
} from './recording-slice.js';

// --- tracking-slice (AR tracking state machine; ports the AR-tracking
//     state machine that previously lived in `ar/tracking-state.ts` — see
//     P2 step 2 in 2026-05-07-csharp-features-not-yet-ported.md). ---
export {
  type TrackingPhase,
  type TrackingSliceState,
  type DeviceOrientation,
  type ResetTransformData,
  type PoseReceivedPayload,
  poseReceived,
  poseLost,
  originReset,
  resetTracking,
  clearLastRestartedPayload,
  trackingReducer,
  selectTrackingPhase,
  selectLastValidPose,
  selectLostFrameCount,
  selectLastRestartedPayload,
  selectLastSensorOrientation,
} from './tracking-slice.js';

// --- qr-detected-slice (opt-in framework slice; Note 3 of the QR-tracking
//     follow-up plan). Apps wire it via `extraReducers: { qrDetected:
//     qrDetectedReducer }`; not a built-in of `createSlamAppStore`. ---
export {
  DEFAULT_QR_MAX_HISTORY,
  type QrSizeStatus,
  type QrSizeEstimate,
  type QrDetectionEntry,
  type QrMarkerState,
  type QrDetectedState,
  type RootWithQrDetected,
  recordQrDetection,
  recordQrSizeEstimate,
  pruneQrDetections,
  clearQrMarker,
  clearAllQrMarkers,
  setQrMaxHistory,
  qrDetectedReducer,
  selectQrMarkers,
  selectQrMarker,
  selectLatestQrDetection,
  selectQrSize,
  selectResolvedQrSizeM,
  selectStableQrPose,
  selectQrPoseStability,
  selectSolvedQrPose,
  selectDerivedQrPlacement,
  selectQrRawObservations,
  type QrPoseStabilityStatus,
  type QrPoseStability,
  type QrPoseStabilityOptions,
  medianQrPosition,
} from './qr-detected-slice.js';

// --- ref-points-slice — moved to recorder app in Iter 3 of the
//     AppFramework / RecorderApp boundary migration. Recorder consumers
//     import these from their own local slice now. ---

// --- library re-exports (kept here for backwards-compat with existing
//     `gps-plus-slam-app-framework/state` imports). ---
export {
  setZeroPos,
  recordGpsEvent,
  add2dImage,
  calcRelativeCoordsInMeters,
} from 'gps-plus-slam-js';
export type {
  LatLong,
  GpsPoint,
  RawGpsPoint,
  RawDeviceOrientation,
  RecordGpsEventPayload,
  Add2dImagePayload,
} from 'gps-plus-slam-js';
export type { DepthPoint, DepthSample } from '../types/ar-types.js';
export type { StorageBackend } from '../storage/storage-backend.js';
export type { SessionMetadata as OpfsSessionMetadata } from '../storage/opfs-storage.js';

// --- gps-event-coordinator ---
export {
  type RecordingCoordinatorConfig,
  updateDeviceOrientation,
  getLastDeviceOrientation,
  eulerToQuaternion,
  resetCoordinatorState,
  extractOdomPosition,
  extractOdomRotation,
  buildRawGpsPoint,
  buildRecordGpsEventPayload,
  createGpsPositionHandler,
} from './gps-event-coordinator.js';

// --- gps-ar-pose-sampler ---
export {
  type GpsAnchorSample,
  type GpsAnchorSampleGpsPoint,
  type CaptureGpsAnchorSampleOptions,
  captureGpsAnchorSample,
} from './gps-ar-pose-sampler.js';

// --- recording-options — moved to the recorder app (2026-07-11 G-1 move,
//     `2026-07-11-1445-recording-options-altitude-move-plan.md`): the settings
//     catalog lives in `GpsPlusSlamJs_RecorderApp/src/state/recording-options.ts`.
//     The framework keeps only the pieces it consumes itself:
//     `ar/ar-crash-isolation.ts` and `visualization/occlusion-mesh.ts`
//     (`OCCLUDER_DEBUG_STYLES` / `OccluderDebugStyle`). ---

// --- recording-replayer ---
export { replayRecording } from './recording-replayer.js';
export type { ReplayRecordingOptions } from './recording-replayer.js';

// --- persistence-middleware ---
export {
  createPersistenceMiddleware,
  slicePrefixOf,
  type PersistenceMiddlewareOptions,
} from './persistence-middleware.js';

// --- create-slam-app-store ---
export {
  createSlamAppStore,
  type SlamAppStore,
  type SlamAppStoreOptions,
  type SlamAppRootState,
  type SlamAppCombinedState,
  type SlamAppMiddleware,
} from './create-slam-app-store.js';

// --- replay-engine ---
export {
  DEFAULT_MAX_DELAY_MS,
  type ReplayState,
  type ProgressCallback,
  type CompleteCallback,
  type ErrorCallback,
  type ReplayAction,
  extractActionTimestamp,
  computeInterActionDelay,
  ReplayEngine,
} from './replay-engine.js';

// --- store-subscribers ---
export {
  type SubscribableStore,
  type StoreSubscriberDeps,
  wireStoreSubscribers,
} from './store-subscribers.js';

// --- replay-session (desktop-replay composer for consumer apps) ---
// Deliberately NOT re-exported from this barrel: replay-session transitively
// imports gps-event-markers → webxr-session (getScene), so barrelling it would
// force every state-barrel importer to eagerly evaluate the heavy AR/scene stack
// — breaking recorder tests that partially mock webxr-session. Consumers deep-
// import it instead: `gps-plus-slam-app-framework/state/replay-session`
// (and `.../state/replay-occupancy-subscriber`).

// --- subscribe-to-selector ---
export { subscribeToSelector } from './subscribe-to-selector.js';

// --- app-selectors ---
export {
  selectAlignmentMatrix,
  selectGpsPositions,
  selectOdometryPositions,
  selectOdometryRotations,
  selectZeroReference,
  selectFrameTilesInWebXR,
} from './app-selectors.js';

// --- tracking-quality (Phase A of
//     docs/2026-05-16-tracking-quality-metrics-plan.md) ---
export {
  trackingQualityReducer,
  createTrackingQualityListenerMiddleware,
  computeTrackingQualityReport,
  computeConvergence,
  computeResidualConsensus,
  computeGpsAccuracy,
  computeCoverage,
  computeGpsVsFusedDivergence,
  matrixDelta,
  snapshotPushed,
  snapshotsTrimmed,
  reportUpdated,
  resetTrackingQuality,
  degradedCountUpdated,
  selectTrackingQuality,
  selectRecentAlignments,
  DEFAULT_TRACKING_QUALITY_OPTIONS,
  type TrackingQualityState,
  type TrackingQualityReport,
  type TrackingQualityOptions,
  type TrackingQualitySliceState,
  type AlignmentSnapshot,
} from './tracking-quality.js';

export {
  computeOnboardingGuidance,
  selectOnboardingGuidance,
  type OnboardingPhase,
  type OnboardingGuidance,
} from './onboarding-guidance.js';
