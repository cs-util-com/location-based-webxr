import type { QuaternionWxyz, RecorderColmapModel } from './model.js';

/** Structured result returned by both model-comparison strategies. */
export type ModelComparison =
  | { readonly equal: true }
  | {
      readonly equal: false;
      readonly path: string;
      readonly reason:
        | 'record-count'
        | 'record-order'
        | 'identifier'
        | 'string-value'
        | 'integer-value'
        | 'numeric-value'
        | 'quaternion-orientation'
        | 'quaternion-sign'
        | 'reference'
        | 'observation'
        | 'track';
    };

type Difference = Exclude<ModelComparison, { readonly equal: true }>;

/** Compare model meaning, including quaternion sign equivalence. */
export function semanticallyEqual(
  left: RecorderColmapModel,
  right: RecorderColmapModel
): ModelComparison {
  return compare(left, right, false);
}

/** Compare every represented no-op value, including quaternion sign. */
export function exactlyPreserved(
  before: RecorderColmapModel,
  after: RecorderColmapModel
): ModelComparison {
  return compare(before, after, true);
}

// eslint-disable-next-line complexity -- ordered first-difference precedence is part of the comparison contract
function compare(
  left: RecorderColmapModel,
  right: RecorderColmapModel,
  exact: boolean
): ModelComparison {
  let failure = compareRecordIds(
    left.cameras.map(({ cameraId }) => cameraId),
    right.cameras.map(({ cameraId }) => cameraId),
    'cameras',
    'cameraId'
  );
  if (failure !== undefined) return failure;

  for (const [index, leftCamera] of left.cameras.entries()) {
    const rightCamera = right.cameras[index]!;
    const path = `cameras[${index}]`;
    failure =
      changed(
        leftCamera.model !== rightCamera.model,
        `${path}.model`,
        'string-value'
      ) ??
      changed(
        leftCamera.width !== rightCamera.width,
        `${path}.width`,
        'integer-value'
      ) ??
      changed(
        leftCamera.height !== rightCamera.height,
        `${path}.height`,
        'integer-value'
      ) ??
      compareNumber(
        leftCamera.intrinsics.fx,
        rightCamera.intrinsics.fx,
        `${path}.intrinsics.fx`,
        exact
      ) ??
      compareNumber(
        leftCamera.intrinsics.fy,
        rightCamera.intrinsics.fy,
        `${path}.intrinsics.fy`,
        exact
      ) ??
      compareNumber(
        leftCamera.intrinsics.cx,
        rightCamera.intrinsics.cx,
        `${path}.intrinsics.cx`,
        exact
      ) ??
      compareNumber(
        leftCamera.intrinsics.cy,
        rightCamera.intrinsics.cy,
        `${path}.intrinsics.cy`,
        exact
      );
    if (failure !== undefined) return failure;
  }

  failure = compareRecordIds(
    left.images.map(({ imageId }) => imageId),
    right.images.map(({ imageId }) => imageId),
    'images',
    'imageId'
  );
  if (failure !== undefined) return failure;

  for (const [index, leftImage] of left.images.entries()) {
    const rightImage = right.images[index]!;
    const path = `images[${index}]`;
    failure =
      changed(
        leftImage.cameraId !== rightImage.cameraId,
        `${path}.cameraId`,
        'reference'
      ) ??
      changed(
        leftImage.name !== rightImage.name,
        `${path}.name`,
        'string-value'
      ) ??
      compareQuaternion(
        leftImage.pose.qvec,
        rightImage.pose.qvec,
        `${path}.pose.qvec`,
        exact
      ) ??
      compareNumberArray(
        leftImage.pose.tvec,
        rightImage.pose.tvec,
        `${path}.pose.tvec`,
        exact
      ) ??
      changed(
        leftImage.observations.length !== rightImage.observations.length,
        `${path}.observations`,
        'observation'
      );
    if (failure !== undefined) return failure;
  }

  failure = compareRecordIds(
    left.points3D.map(({ point3DId }) => point3DId),
    right.points3D.map(({ point3DId }) => point3DId),
    'points3D',
    'point3DId'
  );
  if (failure !== undefined) return failure;

  for (const [index, leftPoint] of left.points3D.entries()) {
    const rightPoint = right.points3D[index]!;
    const path = `points3D[${index}]`;
    failure =
      compareNumberArray(leftPoint.xyz, rightPoint.xyz, `${path}.xyz`, exact) ??
      compareIntegerArray(leftPoint.rgb, rightPoint.rgb, `${path}.rgb`) ??
      compareNumber(
        leftPoint.error,
        rightPoint.error,
        `${path}.error`,
        exact
      ) ??
      changed(
        leftPoint.track.length !== rightPoint.track.length,
        `${path}.track`,
        'track'
      );
    if (failure !== undefined) return failure;
  }

  return { equal: true };
}

function compareRecordIds(
  left: readonly number[],
  right: readonly number[],
  collection: 'cameras' | 'images' | 'points3D',
  idField: 'cameraId' | 'imageId' | 'point3DId'
): Difference | undefined {
  if (left.length !== right.length) {
    return difference(collection, 'record-count');
  }

  const mismatch = left.findIndex((id, index) => id !== right[index]);
  if (mismatch === -1) return undefined;

  const rightIds = new Set(right);
  const reason = left.every((id) => rightIds.has(id))
    ? 'record-order'
    : 'identifier';
  return difference(`${collection}[${mismatch}].${idField}`, reason);
}

function compareQuaternion(
  left: QuaternionWxyz,
  right: QuaternionWxyz,
  path: string,
  exact: boolean
): Difference | undefined {
  const sign =
    left.reduce((dot, component, index) => dot + component * right[index]!, 0) <
    0
      ? -1
      : 1;

  for (const [index, component] of left.entries()) {
    if (!close(component, sign * right[index]!)) {
      return difference(`${path}[${index}]`, 'quaternion-orientation');
    }
  }
  if (!exact) return undefined;

  for (const [index, component] of left.entries()) {
    if (component !== right[index]) {
      return difference(
        `${path}[${index}]`,
        sign === -1 ? 'quaternion-sign' : 'numeric-value'
      );
    }
  }
  return undefined;
}

function compareNumberArray(
  left: readonly number[],
  right: readonly number[],
  path: string,
  exact: boolean
): Difference | undefined {
  for (const [index, value] of left.entries()) {
    const failure = compareNumber(
      value,
      right[index]!,
      `${path}[${index}]`,
      exact
    );
    if (failure !== undefined) return failure;
  }
  return undefined;
}

function compareIntegerArray(
  left: readonly number[],
  right: readonly number[],
  path: string
): Difference | undefined {
  const index = left.findIndex((value, current) => value !== right[current]);
  return index === -1
    ? undefined
    : difference(`${path}[${index}]`, 'integer-value');
}

function compareNumber(
  left: number,
  right: number,
  path: string,
  exact: boolean
): Difference | undefined {
  return changed(
    exact ? left !== right : !close(left, right),
    path,
    'numeric-value'
  );
}

function close(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <=
    Math.max(1e-12, 1e-12 * Math.max(Math.abs(left), Math.abs(right)))
  );
}

function changed(
  condition: boolean,
  path: string,
  reason: Difference['reason']
): Difference | undefined {
  return condition ? difference(path, reason) : undefined;
}

function difference(path: string, reason: Difference['reason']): Difference {
  return { equal: false, path, reason };
}
