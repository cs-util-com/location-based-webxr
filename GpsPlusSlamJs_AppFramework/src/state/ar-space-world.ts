/**
 * The composed AR-space selectors: the AR-space correction followed by the
 * GPS alignment, `A * Delta(e)`, and the world pose of a raw local matrix.
 *
 * Kept apart from the slice and the registry on purpose: those read only
 * the correction track, never the alignment, and a structure test pins that
 * their import closure stays free of this module.
 *
 * NOT FOR WORLD OR MAP CONSUMERS YET: until the GPS alignment is fitted on
 * the corrected odometry, `A` is fitted across the frames before and after a
 * jump, so pairing it with a corrected `Delta` misplaces content by about
 * the jump size. Read these only for inspection until then.
 *
 * Sidecar: `ar-space-world.ts.md`.
 */
import { createSelector } from '@reduxjs/toolkit';
import type { Matrix4 } from 'gps-plus-slam-js';
import { multiplyMatrix4, poseToMatrix4 } from '../ar/ar-space-correction';
import { selectAlignmentMatrix } from './app-selectors';
import {
  selectArSpaceCorrectionEpoch,
  selectCorrectionTrack,
  type RootWithArSpaceCorrection,
} from './ar-space-correction-slice';

type RootWithAlignment = Parameters<typeof selectAlignmentMatrix>[0];
type RootWithBoth = RootWithArSpaceCorrection & RootWithAlignment;

const selectArSpaceToWorldList = createSelector(
  [selectCorrectionTrack, selectAlignmentMatrix],
  (track, alignment): readonly Matrix4[] | null =>
    alignment === null
      ? null
      : track.map((delta) => multiplyMatrix4(alignment, poseToMatrix4(delta)))
);

/**
 * `A * Delta(e)`: the map from epoch-`e` odometry coordinates to the
 * alignment's world frame, column-major. `null` before an alignment exists.
 * Throws a `RangeError` for an epoch that is not an integer in `0..n`.
 *
 * Not for world or map consumers until the alignment is fitted on the
 * corrected odometry (see the module comment): before that, the result is
 * off by about the jump size after a relocalization.
 */
export function selectArSpaceToWorld(
  state: RootWithBoth,
  epoch: number
): Matrix4 | null {
  const n = selectArSpaceCorrectionEpoch(state);
  if (!Number.isInteger(epoch) || epoch < 0 || epoch > n) {
    throw new RangeError(`epoch ${epoch} is outside 0..${n}`);
  }
  return selectArSpaceToWorldList(state)?.[epoch] ?? null;
}

const IDENTITY_MATRIX4 = poseToMatrix4({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
});

/**
 * World pose of a raw local matrix `xRaw` of epoch `epoch` whose parent maps
 * into O by `parentToGroup` (identity by default): `A * Delta(e) * P * X_raw`.
 * `null` before an alignment exists; `RangeError` as `selectArSpaceToWorld`.
 *
 * Not for world or map consumers until the alignment is fitted on the
 * corrected odometry (see the module comment): before that, the result is
 * off by about the jump size after a relocalization.
 */
export function arSpaceWorldPose(
  state: RootWithBoth,
  xRaw: Matrix4,
  epoch: number,
  parentToGroup: Matrix4 = IDENTITY_MATRIX4
): Matrix4 | null {
  const toWorld = selectArSpaceToWorld(state, epoch);
  if (toWorld === null) return null;
  return multiplyMatrix4(multiplyMatrix4(toWorld, parentToGroup), xRaw);
}
