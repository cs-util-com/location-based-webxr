import { describe, expect, it } from 'vitest';

import type { RecorderColmapModel } from './model.js';
import { ColmapError, validateRecorderColmapModel } from './validate.js';

function validModel(): RecorderColmapModel {
  return {
    cameras: [
      {
        cameraId: 1,
        model: 'PINHOLE',
        width: 1920,
        height: 1080,
        intrinsics: { fx: 1200, fy: 1200, cx: 960, cy: 540 },
      },
    ],
    images: [
      {
        imageId: 1,
        cameraId: 1,
        name: 'frame-000001.jpg',
        pose: { qvec: [1, 0, 0, 0], tvec: [0, 0, 0] },
        observations: [],
      },
    ],
    points3D: [],
  };
}

function validPoint3D(): RecorderColmapModel['points3D'][number] {
  return {
    point3DId: 1,
    xyz: [0, 0, 0],
    rgb: [0, 128, 255],
    error: 0,
    track: [],
  };
}

function addImage(
  model: RecorderColmapModel,
  overrides: Record<string, unknown>
): void {
  Object.assign(model, {
    images: [...model.images, { ...model.images[0]!, ...overrides }],
  });
}

function setPoint(
  model: RecorderColmapModel,
  overrides: Record<string, unknown>
): void {
  Object.assign(model, {
    points3D: [{ ...validPoint3D(), ...overrides }],
  });
}

function expectFailure(
  model: RecorderColmapModel,
  kind: ColmapError['kind'],
  field: string
): ColmapError {
  try {
    validateRecorderColmapModel(model);
  } catch (error) {
    expect(error).toBeInstanceOf(ColmapError);
    expect(error).toMatchObject({ kind, field });
    return error as ColmapError;
  }

  throw new Error(`Expected ${kind} failure for ${field}`);
}

type InvalidCase = readonly [
  name: string,
  mutate: (model: RecorderColmapModel) => unknown,
  kind: ColmapError['kind'],
  field: string,
];

const invalidCases: InvalidCase[] = [
  [
    'missing cameras',
    (m) => Object.assign(m, { cameras: [] }),
    'validation',
    'cameras',
  ],
  [
    'multiple cameras',
    (m) =>
      Object.assign(m, {
        cameras: [...m.cameras, { ...m.cameras[0]!, cameraId: 2 }],
      }),
    'validation',
    'cameras',
  ],
  [
    'a fractional camera ID',
    (m) => Object.assign(m.cameras[0]!, { cameraId: 1.5 }),
    'validation',
    'cameras[0].cameraId',
  ],
  [
    'an unsupported camera model',
    (m) => Object.assign(m.cameras[0]!, { model: 'OPENCV' }),
    'unsupported-profile',
    'cameras[0].model',
  ],
  [
    'a non-positive camera width',
    (m) => Object.assign(m.cameras[0]!, { width: 0 }),
    'validation',
    'cameras[0].width',
  ],
  [
    'a non-positive camera height',
    (m) => Object.assign(m.cameras[0]!, { height: 0 }),
    'validation',
    'cameras[0].height',
  ],
  [
    'a non-positive focal length',
    (m) => Object.assign(m.cameras[0]!.intrinsics, { fx: 0 }),
    'validation',
    'cameras[0].intrinsics.fx',
  ],
  [
    'a non-finite focal length',
    (m) => Object.assign(m.cameras[0]!.intrinsics, { fy: Infinity }),
    'validation',
    'cameras[0].intrinsics.fy',
  ],
  [
    'a non-finite principal point x-coordinate',
    (m) => Object.assign(m.cameras[0]!.intrinsics, { cx: NaN }),
    'validation',
    'cameras[0].intrinsics.cx',
  ],
  [
    'a non-finite principal point y-coordinate',
    (m) => Object.assign(m.cameras[0]!.intrinsics, { cy: Infinity }),
    'validation',
    'cameras[0].intrinsics.cy',
  ],
  [
    'missing images',
    (m) => Object.assign(m, { images: [] }),
    'validation',
    'images',
  ],
  [
    'a non-positive image ID',
    (m) => Object.assign(m.images[0]!, { imageId: 0 }),
    'validation',
    'imageId',
  ],
  [
    'a duplicate image ID',
    (m) => addImage(m, { name: 'frame-000002.jpg' }),
    'validation',
    'imageId',
  ],
  [
    'a duplicate image name',
    (m) => addImage(m, { imageId: 2 }),
    'validation',
    'name',
  ],
  [
    'a non-finite quaternion',
    (m) => Object.assign(m.images[0]!.pose, { qvec: [Infinity, 0, 0, 0] }),
    'validation',
    'pose.qvec',
  ],
  [
    'a quaternion with the wrong length',
    (m) => Object.assign(m.images[0]!.pose, { qvec: [1, 0, 0] }),
    'validation',
    'pose.qvec',
  ],
  [
    'a non-unit quaternion',
    (m) => Object.assign(m.images[0]!.pose, { qvec: [2, 0, 0, 0] }),
    'validation',
    'pose.qvec',
  ],
  [
    'a non-finite translation vector',
    (m) => Object.assign(m.images[0]!.pose, { tvec: [0, Infinity, 0] }),
    'validation',
    'pose.tvec',
  ],
  [
    'a translation vector with the wrong length',
    (m) => Object.assign(m.images[0]!.pose, { tvec: [0, 0] }),
    'validation',
    'pose.tvec',
  ],
  [
    'image observations',
    (m) => Object.assign(m.images[0]!, { observations: [{}] }),
    'unsupported-profile',
    'observations',
  ],
  [
    'an unsafe Point3D ID',
    (m) => setPoint(m, { point3DId: Number.MAX_SAFE_INTEGER + 1 }),
    'validation',
    'point3DId',
  ],
  [
    'a duplicate Point3D ID',
    (m) => Object.assign(m, { points3D: [validPoint3D(), validPoint3D()] }),
    'validation',
    'point3DId',
  ],
  [
    'non-finite Point3D coordinates',
    (m) => setPoint(m, { xyz: [0, NaN, 0] }),
    'validation',
    'xyz',
  ],
  [
    'Point3D coordinates with the wrong length',
    (m) => setPoint(m, { xyz: [0, 0] }),
    'validation',
    'xyz',
  ],
  [
    'non-finite Point3D RGB values',
    (m) => setPoint(m, { rgb: [0, Infinity, 0] }),
    'validation',
    'rgb',
  ],
  [
    'Point3D RGB values with the wrong length',
    (m) => setPoint(m, { rgb: [0, 0] }),
    'validation',
    'rgb',
  ],
  [
    'out-of-range Point3D RGB values',
    (m) => setPoint(m, { rgb: [0, 0, 256] }),
    'validation',
    'rgb',
  ],
  [
    'fractional Point3D RGB values',
    (m) => setPoint(m, { rgb: [0, 0, 1.5] }),
    'validation',
    'rgb',
  ],
  [
    'a negative Point3D error',
    (m) => setPoint(m, { error: -1 }),
    'validation',
    'error',
  ],
  [
    'a non-finite Point3D error',
    (m) => setPoint(m, { error: Infinity }),
    'validation',
    'error',
  ],
  [
    'Point3D tracks',
    (m) => setPoint(m, { track: [{}] }),
    'unsupported-profile',
    'track',
  ],
];

describe('validateRecorderColmapModel', () => {
  it('accepts a valid recorder model', () => {
    expect(() => validateRecorderColmapModel(validModel())).not.toThrow();
  });

  it('reports the missing camera and affected image', () => {
    const model = validModel();
    Object.assign(model.images[0]!, { cameraId: 2 });

    const error = expectFailure(model, 'reference', 'cameraId');
    expect(error.path).toBe('images[0].cameraId');
    expect(error.message).toContain('Image 1');
    expect(error.message).toContain('camera 2');
  });

  it.each(invalidCases)('rejects %s', (_name, mutate, kind, field) => {
    expect.hasAssertions();
    const model = validModel();
    mutate(model);
    expectFailure(model, kind, field);
  });
  it.each([
    '',
    '.',
    '..',
    'folder/image.jpg',
    'folder\\image.jpg',
    'bad name.jpg',
    'bad\tname.jpg',
    'bad"name.jpg',
    "bad'name.jpg",
    'bad\0name.jpg',
    'bad\x7fname.jpg',
  ])('rejects invalid image name %j', (name) => {
    expect.hasAssertions();
    const model = validModel();
    Object.assign(model.images[0]!, { name });
    expectFailure(model, 'validation', 'name');
  });

  it.each(['frame-000001.jpg', 'image.png', 'frame..jpg'])(
    'accepts valid image name %j',
    (name) => {
      const model = validModel();
      Object.assign(model.images[0]!, { name });
      expect(() => validateRecorderColmapModel(model)).not.toThrow();
    }
  );
});
