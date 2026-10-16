/**
 * Recorder-specific typed COLMAP model for Task 2 Goal 1A.
 *
 * The ordered arrays preserve source-record order. The current validator will
 * accept one PINHOLE camera and empty observations/tracks, while the explicit
 * collection types keep the shared seam extensible for later reviewed work.
 */

export type CameraId = number;
export type ImageId = number;
export type Point3DId = number;
export type Point2DIndex = number;

export type Vector3 = readonly [number, number, number];
export type QuaternionWxyz = readonly [number, number, number, number];
export type Rgb8 = readonly [number, number, number];

export interface PinholeIntrinsics {
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
}

export interface PinholeCamera {
  readonly cameraId: CameraId;
  readonly model: 'PINHOLE';
  readonly width: number;
  readonly height: number;
  readonly intrinsics: PinholeIntrinsics;
}

/** Add later reviewed camera variants to this discriminated union. */
export type ColmapCamera = PinholeCamera;

/** COLMAP world-to-camera transform using quaternion order [qw, qx, qy, qz]. */
export interface WorldToCameraPose {
  readonly qvec: QuaternionWxyz;
  readonly tvec: Vector3;
}

export interface ImageObservation {
  readonly x: number;
  readonly y: number;
  readonly point3DId: Point3DId | null;
}

export interface ColmapImage {
  readonly imageId: ImageId;
  readonly cameraId: CameraId;
  readonly name: string;
  readonly pose: WorldToCameraPose;
  readonly observations: readonly ImageObservation[];
}

export interface Point3DTrackElement {
  readonly imageId: ImageId;
  readonly point2DIndex: Point2DIndex;
}

export interface ColmapPoint3D {
  readonly point3DId: Point3DId;
  readonly xyz: Vector3;
  readonly rgb: Rgb8;
  readonly error: number;
  readonly track: readonly Point3DTrackElement[];
}

export interface RecorderColmapModel {
  readonly cameras: readonly ColmapCamera[];
  readonly images: readonly ColmapImage[];
  readonly points3D: readonly ColmapPoint3D[];
}
