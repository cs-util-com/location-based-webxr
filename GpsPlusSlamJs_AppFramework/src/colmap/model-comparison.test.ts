import { describe, expect, it } from 'vitest';

import type { RecorderColmapModel } from './model.js';
import {
  exactlyPreserved,
  semanticallyEqual,
  type ModelComparison,
} from './model-comparison.js';

function model(): RecorderColmapModel {
  return {
    cameras: [
      {
        cameraId: 5,
        model: 'PINHOLE',
        width: 823,
        height: 1920,
        intrinsics: { fx: 1200, fy: 1201, cx: 411.5, cy: 960 },
      },
    ],
    images: [
      {
        imageId: 9,
        cameraId: 5,
        name: 'frame-9.jpg',
        pose: { qvec: [1, 0, 0, 0], tvec: [1, -0, 3] },
        observations: [],
      },
      {
        imageId: 2,
        cameraId: 5,
        name: 'frame-2.jpg',
        pose: { qvec: [1, 0, 0, 0], tvec: [-4, 5, -6] },
        observations: [],
      },
    ],
    points3D: [
      {
        point3DId: 12,
        xyz: [1.5, -2, 0.3],
        rgb: [0, 128, 255],
        error: 0.25,
        track: [],
      },
      {
        point3DId: 4,
        xyz: [0, 2, 1000],
        rgb: [1, 2, 3],
        error: 0,
        track: [],
      },
    ],
  };
}

function expectDifference(
  comparison: ModelComparison,
  path: string,
  reason: Exclude<ModelComparison, { equal: true }>['reason']
): void {
  expect(comparison).toEqual({ equal: false, path, reason });
}

describe('model comparisons', () => {
  it('accepts equal models and treats negative zero as preserved', () => {
    const original = model();
    const right: RecorderColmapModel = {
      ...original,
      images: [
        {
          ...original.images[0]!,
          pose: { ...original.images[0]!.pose, tvec: [1, 0, 3] },
        },
        ...original.images.slice(1),
      ],
    };

    expect(semanticallyEqual(model(), right)).toEqual({ equal: true });
    expect(exactlyPreserved(model(), right)).toEqual({ equal: true });
  });

  it('accepts a quaternion sign flip semantically but not exactly', () => {
    const left = model();
    const right: RecorderColmapModel = {
      ...left,
      images: [
        {
          ...left.images[0]!,
          pose: { ...left.images[0]!.pose, qvec: [-1, 0, 0, 0] },
        },
        ...left.images.slice(1),
      ],
    };

    expect(semanticallyEqual(left, right)).toEqual({ equal: true });
    expectDifference(
      exactlyPreserved(left, right),
      'images[0].pose.qvec[0]',
      'quaternion-sign'
    );
  });

  it('allows only semantic tolerance for a tiny floating change', () => {
    const left = model();
    const right: RecorderColmapModel = {
      ...left,
      images: [
        {
          ...left.images[0]!,
          pose: {
            ...left.images[0]!.pose,
            tvec: [1 + 5e-13, -0, 3],
          },
        },
        ...left.images.slice(1),
      ],
    };

    expect(semanticallyEqual(left, right)).toEqual({ equal: true });
    expectDifference(
      exactlyPreserved(left, right),
      'images[0].pose.tvec[0]',
      'numeric-value'
    );
  });

  it('reports a changed quaternion orientation', () => {
    expect.hasAssertions();
    const original = model();
    const right: RecorderColmapModel = {
      ...original,
      images: [
        {
          ...original.images[0]!,
          pose: { ...original.images[0]!.pose, qvec: [0, 1, 0, 0] },
        },
        ...original.images.slice(1),
      ],
    };

    expectDifference(
      semanticallyEqual(model(), right),
      'images[0].pose.qvec[0]',
      'quaternion-orientation'
    );
  });

  it.each([
    {
      name: 'record count',
      change: (value: RecorderColmapModel): RecorderColmapModel => ({
        ...value,
        images: value.images.slice(0, 1),
      }),
      path: 'images',
      reason: 'record-count',
    },
    {
      name: 'record order',
      change: (value: RecorderColmapModel): RecorderColmapModel => ({
        ...value,
        images: [...value.images].reverse(),
      }),
      path: 'images[0].imageId',
      reason: 'record-order',
    },
    {
      name: 'identifier',
      change: (value: RecorderColmapModel): RecorderColmapModel => ({
        ...value,
        points3D: [
          { ...value.points3D[0]!, point3DId: 13 },
          ...value.points3D.slice(1),
        ],
      }),
      path: 'points3D[0].point3DId',
      reason: 'identifier',
    },
    {
      name: 'reference',
      change: (value: RecorderColmapModel): RecorderColmapModel => ({
        ...value,
        images: [
          { ...value.images[0]!, cameraId: 6 },
          ...value.images.slice(1),
        ],
      }),
      path: 'images[0].cameraId',
      reason: 'reference',
    },
    {
      name: 'integer',
      change: (value: RecorderColmapModel): RecorderColmapModel => ({
        ...value,
        cameras: [{ ...value.cameras[0]!, width: 824 }],
      }),
      path: 'cameras[0].width',
      reason: 'integer-value',
    },
    {
      name: 'RGB integer',
      change: (value: RecorderColmapModel): RecorderColmapModel => ({
        ...value,
        points3D: [
          { ...value.points3D[0]!, rgb: [1, 128, 255] },
          ...value.points3D.slice(1),
        ],
      }),
      path: 'points3D[0].rgb[0]',
      reason: 'integer-value',
    },
    {
      name: 'string',
      change: (value: RecorderColmapModel): RecorderColmapModel => ({
        ...value,
        images: [
          { ...value.images[0]!, name: 'changed.jpg' },
          ...value.images.slice(1),
        ],
      }),
      path: 'images[0].name',
      reason: 'string-value',
    },
    {
      name: 'observation state',
      change: (value: RecorderColmapModel): RecorderColmapModel => ({
        ...value,
        images: [
          {
            ...value.images[0]!,
            observations: [{ x: 1, y: 2, point3DId: null }],
          },
          ...value.images.slice(1),
        ],
      }),
      path: 'images[0].observations',
      reason: 'observation',
    },
    {
      name: 'track state',
      change: (value: RecorderColmapModel): RecorderColmapModel => ({
        ...value,
        points3D: [
          {
            ...value.points3D[0]!,
            track: [{ imageId: 9, point2DIndex: 0 }],
          },
          ...value.points3D.slice(1),
        ],
      }),
      path: 'points3D[0].track',
      reason: 'track',
    },
  ] as const)(
    'reports the first $name difference',
    ({ change, path, reason }) => {
      expect.hasAssertions();
      expectDifference(
        exactlyPreserved(model(), change(model())),
        path,
        reason
      );
    }
  );

  it('checks cameras before later collections', () => {
    expect.hasAssertions();
    const original = model();
    const right: RecorderColmapModel = {
      ...original,
      cameras: [
        {
          ...original.cameras[0]!,
          intrinsics: { ...original.cameras[0]!.intrinsics, fx: 1300 },
        },
      ],
      images: [
        { ...original.images[0]!, name: 'changed.jpg' },
        ...original.images.slice(1),
      ],
    };

    expectDifference(
      semanticallyEqual(model(), right),
      'cameras[0].intrinsics.fx',
      'numeric-value'
    );
  });
});
