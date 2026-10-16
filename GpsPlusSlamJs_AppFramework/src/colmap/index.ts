export type {
  CameraId,
  ColmapCamera,
  ColmapImage,
  ColmapPoint3D,
  ImageId,
  ImageObservation,
  PinholeCamera,
  PinholeIntrinsics,
  Point2DIndex,
  Point3DId,
  Point3DTrackElement,
  QuaternionWxyz,
  RecorderColmapModel,
  Rgb8,
  Vector3,
  WorldToCameraPose,
} from './model.js';

export {
  ColmapError,
  type ColmapFailureContext,
  type ColmapFailureKind,
} from './validate.js';

export {
  exactlyPreserved,
  semanticallyEqual,
  type ModelComparison,
} from './model-comparison.js';

export {
  readRecorderZip,
  roundTripRecorderZip,
  summarizeRecorderModel,
  writeRecorderZip,
  type DatasetSummary,
  type RecorderArchiveSource,
  type RecorderDataset,
  type RecorderRoundTripResult,
  type RoundTripVerification,
} from './round-trip.js';
