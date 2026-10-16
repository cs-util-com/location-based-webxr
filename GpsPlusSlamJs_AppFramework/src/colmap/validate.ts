/** Shared contextual failure contract for the COLMAP boundary. */
import type { RecorderColmapModel } from './model.js';

export type ColmapFailureKind =
  'archive' | 'unsupported-profile' | 'syntax' | 'validation' | 'reference';

export interface ColmapFailureContext {
  readonly kind: ColmapFailureKind;
  readonly path?: string;
  readonly line?: number;
  readonly field?: string;
}

/**
 * The one public error class used by expected 1A input and archive failures.
 */
export class ColmapError extends Error {
  readonly kind: ColmapFailureKind;
  readonly path?: string;
  readonly line?: number;
  readonly field?: string;

  constructor(
    message: string,
    context: ColmapFailureContext,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ColmapError';
    this.kind = context.kind;
    if (context.path !== undefined) this.path = context.path;
    if (context.line !== undefined) this.line = context.line;
    if (context.field !== undefined) this.field = context.field;
  }
}

// eslint-disable-next-line complexity -- the validator reports the first contract violation in stable order
export function validateRecorderColmapModel(model: RecorderColmapModel): void {
  if (model.cameras.length !== 1) {
    fail(
      'validation',
      'cameras',
      'Exactly one camera is required',
      model.cameras.length === 0 ? 'cameras' : 'cameras[1]'
    );
  }

  const camera = model.cameras[0]!;
  requirePositiveSafeInteger(camera.cameraId, 'cameras[0].cameraId');
  if (camera.model !== 'PINHOLE') {
    fail(
      'unsupported-profile',
      'cameras[0].model',
      'Only PINHOLE camera model is supported'
    );
  }
  requirePositiveSafeInteger(camera.width, 'cameras[0].width');
  requirePositiveSafeInteger(camera.height, 'cameras[0].height');
  requirePositiveFiniteNumber(camera.intrinsics.fx, 'cameras[0].intrinsics.fx');
  requirePositiveFiniteNumber(camera.intrinsics.fy, 'cameras[0].intrinsics.fy');
  if (!Number.isFinite(camera.intrinsics.cx)) {
    fail('validation', 'cameras[0].intrinsics.cx', 'cx must be finite');
  }
  if (!Number.isFinite(camera.intrinsics.cy)) {
    fail('validation', 'cameras[0].intrinsics.cy', 'cy must be finite');
  }

  const imageIds = new Set<number>();
  const imageNames = new Set<string>();
  if (model.images.length === 0) {
    fail('validation', 'images', 'At least one image is required');
  }

  for (const [imageIndex, image] of model.images.entries()) {
    const imagePath = `images[${imageIndex}]`;
    requirePositiveSafeInteger(
      image.imageId,
      'imageId',
      `${imagePath}.imageId`
    );
    if (imageIds.has(image.imageId)) {
      fail(
        'validation',
        'imageId',
        'Duplicate image ID',
        `${imagePath}.imageId`
      );
    }
    if (imageNames.has(image.name)) {
      fail('validation', 'name', 'Duplicate image name', `${imagePath}.name`);
    }
    imageIds.add(image.imageId);
    imageNames.add(image.name);

    if (image.cameraId !== camera.cameraId) {
      throw new ColmapError(
        `Image ${image.imageId} references missing camera ${image.cameraId}`,
        {
          kind: 'reference',
          field: 'cameraId',
          path: `${imagePath}.cameraId`,
        }
      );
    }

    if (
      image.name.length === 0 ||
      image.name === '.' ||
      image.name === '..' ||
      [...image.name].some(
        (character) =>
          character <= ' ' ||
          character === '\x7f' ||
          `/\\'"`.includes(character)
      )
    ) {
      fail('validation', 'name', 'Image name is invalid', `${imagePath}.name`);
    }

    const qvec = image.pose.qvec;
    requireFiniteArray(qvec, 'pose.qvec', `${imagePath}.pose.qvec`);
    if (qvec.length !== 4) {
      fail(
        'validation',
        'pose.qvec',
        'Quaternion must have length 4',
        `${imagePath}.pose.qvec`
      );
    }
    const norm = Math.hypot(...qvec);
    if (Math.abs(norm - 1) > 1e-6) {
      fail(
        'validation',
        'pose.qvec',
        'Quaternion must have unit length',
        `${imagePath}.pose.qvec`
      );
    }

    const tvec = image.pose.tvec;
    requireFiniteArray(tvec, 'pose.tvec', `${imagePath}.pose.tvec`);
    if (tvec.length !== 3) {
      fail(
        'validation',
        'pose.tvec',
        'Translation vector must have length 3',
        `${imagePath}.pose.tvec`
      );
    }

    if (image.observations.length !== 0) {
      fail(
        'unsupported-profile',
        'observations',
        'Image observations are not supported',
        `${imagePath}.observations`
      );
    }
  }

  const point3DIds = new Set<number>();
  for (const [pointIndex, point3D] of model.points3D.entries()) {
    const pointPath = `points3D[${pointIndex}]`;
    requirePositiveSafeInteger(
      point3D.point3DId,
      'point3DId',
      `${pointPath}.point3DId`
    );
    if (point3DIds.has(point3D.point3DId)) {
      fail(
        'validation',
        'point3DId',
        'Duplicate point3D ID',
        `${pointPath}.point3DId`
      );
    }
    point3DIds.add(point3D.point3DId);

    requireFiniteArray(point3D.xyz, 'xyz', `${pointPath}.xyz`);
    if (point3D.xyz.length !== 3) {
      fail(
        'validation',
        'xyz',
        'Point3D coordinates must have length 3',
        `${pointPath}.xyz`
      );
    }
    requireFiniteArray(point3D.rgb, 'rgb', `${pointPath}.rgb`);
    if (point3D.rgb.length !== 3) {
      fail(
        'validation',
        'rgb',
        'Point3D RGB values must have length 3',
        `${pointPath}.rgb`
      );
    }
    if (
      point3D.rgb.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 255
      )
    ) {
      fail(
        'validation',
        'rgb',
        'Point3D RGB values must be integers in the range [0, 255]',
        `${pointPath}.rgb`
      );
    }
    if (!Number.isFinite(point3D.error) || point3D.error < 0) {
      fail(
        'validation',
        'error',
        'Point3D error must be a non-negative finite number',
        `${pointPath}.error`
      );
    }
    if (point3D.track.length !== 0) {
      fail(
        'unsupported-profile',
        'track',
        'Point3D tracks are not supported',
        `${pointPath}.track`
      );
    }
  }
}

function fail(
  kind: ColmapFailureKind,
  field: string,
  message: string,
  path = field
): never {
  throw new ColmapError(message, { kind, field, path });
}

function requirePositiveSafeInteger(
  value: number,
  field: string,
  path = field
): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('validation', field, `${field} must be a positive safe integer`, path);
  }
}

function requirePositiveFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    fail('validation', field, `${field} must be a positive finite number`);
  }
}

function requireFiniteArray(value: unknown, field: string, path = field): void {
  if (!Array.isArray(value) || !value.every(Number.isFinite)) {
    fail(
      'validation',
      field,
      `${field} must be a finite list of numbers`,
      path
    );
  }
}
