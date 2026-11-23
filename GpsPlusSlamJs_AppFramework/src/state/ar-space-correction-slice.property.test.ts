/**
 * Property tests for the composed AR-space selectors. three.js is the
 * oracle, never the module's own helpers.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import type { Matrix4 } from 'gps-plus-slam-js';
import { poseToMatrix4 } from '../ar/ar-space-correction';
import {
  arSpaceWorldPose,
  selectCorrectionTrack,
  type RelocalizationObservation,
} from './ar-space-correction-slice';

const num = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const unitQuaternion = fc
  .tuple(num(-1, 1), num(-1, 1), num(-1, 1), num(-1, 1))
  .filter((q) => Math.hypot(...q) > 0.1)
  .map((q): [number, number, number, number] => {
    const n = Math.hypot(...q);
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  });
const pose = fc.record({
  position: fc.tuple(num(-20, 20), num(-3, 3), num(-20, 20)),
  rotation: unitQuaternion,
});
const rigid = pose.map((p) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...p.position),
    new THREE.Quaternion(...p.rotation),
    new THREE.Vector3(1, 1, 1)
  )
);

const maxDiff = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

describe('ar-space-correction-slice (properties)', () => {
  it('U3: arSpaceWorldPose is A * Delta(e) * P * X_raw for every epoch', () => {
    // Why this test matters: with random, non-commuting A, jumps and P only
    // the stated order matches; the deterministic test shows the other
    // orders fail, this one that the stated order holds everywhere.
    fc.assert(
      fc.property(
        rigid,
        fc.array(pose, { minLength: 1, maxLength: 3 }),
        rigid,
        rigid,
        fc.nat(),
        (A, newPoses, P, X, rawEpoch) => {
          const observations: RelocalizationObservation[] = newPoses.map(
            (newPose, i) => ({
              t: 1000 * (i + 1),
              tLast: 1000 * (i + 1) - 33,
              lastPose: { position: [0, 1.5, 0], rotation: [0, 0, 0, 1] },
              tPrev: null,
              prevPose: null,
              newPose,
            })
          );
          const state = {
            gpsData: {
              gpsEvents: { alignmentMatrix: A.toArray() as unknown as Matrix4 },
            },
            arSpaceCorrection: { observations },
          } as unknown as Parameters<typeof arSpaceWorldPose>[0];
          const epoch = rawEpoch % (observations.length + 1);
          const delta = new THREE.Matrix4().fromArray([
            ...poseToMatrix4(selectCorrectionTrack(state)[epoch]!),
          ]);
          const expected = A.clone()
            .multiply(delta)
            .multiply(P)
            .multiply(X)
            .toArray();
          const got = arSpaceWorldPose(
            state,
            X.toArray() as unknown as Matrix4,
            epoch,
            P.toArray() as unknown as Matrix4
          )!;
          expect(maxDiff(got, expected)).toBeLessThan(1e-9);
        }
      )
    );
  });
});
