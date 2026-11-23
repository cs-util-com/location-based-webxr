import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Pose } from './qr/qr-pose';
import { WEBXR_TO_NUE } from './webxr-nue-basis';
import {
  COMPENSATE_CAMERA_MOTION,
  IDENTITY_POSE,
  MAX_EXTRAPOLATION_RATIO,
  correctionTrack,
  epochAt,
  jumpTransform,
  poseToMatrix4,
  shownLocalMatrix,
  type RelocalizationJump,
} from './ar-space-correction';

const fromThree = (m: THREE.Matrix4): Pose => {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  m.decompose(p, q, new THREE.Vector3());
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
};
const matrixOf = (d: Pose): THREE.Matrix4 =>
  new THREE.Matrix4().fromArray([...poseToMatrix4(d)]);

/** A fixed frame switch: 3 m mostly horizontal, 4 deg yaw, 1 deg tilt. */
const JUMP = new THREE.Matrix4().compose(
  new THREE.Vector3(2.4, 0.1, -1.8),
  new THREE.Quaternion().setFromEuler(
    new THREE.Euler(THREE.MathUtils.degToRad(1), THREE.MathUtils.degToRad(4), 0)
  ),
  new THREE.Vector3(1, 1, 1)
);

/** Walking speed (m/s) of the synthetic user; a normal walk. */
const WALK_M_S = 1.4;
/** Neck-to-camera distance (m): the head turns about the neck, not the lens. */
const NECK_TO_CAMERA_M = 0.1;

/**
 * Raw WebXR camera pose of a user walking along +X while turning the head
 * about a neck pivot at `rateDegS`. Not exactly the compensation's model:
 * the camera's position runs on an arc, not a line.
 */
function walkingCamera(tS: number, rateDegS: number): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    THREE.MathUtils.degToRad(rateDegS * tS)
  );
  const neck = new THREE.Vector3(WALK_M_S * tS, 1.6, 0);
  const position = neck.add(
    new THREE.Vector3(0, 0, -NECK_TO_CAMERA_M).applyQuaternion(q)
  );
  return new THREE.Matrix4().compose(position, q, new THREE.Vector3(1, 1, 1));
}

/** Largest error (m) of `d` against JUMP at `radius` m around the camera, in O. */
function residualAt(d: Pose, camera: THREE.Vector3, radius: number): number {
  const D = matrixOf(d);
  let worst = 0;
  for (const dir of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const) {
    const x = camera
      .clone()
      .add(new THREE.Vector3(...dir).multiplyScalar(radius));
    const truth = x.clone().applyMatrix4(JUMP).applyMatrix4(WEBXR_TO_NUE);
    const got = x.clone().applyMatrix4(WEBXR_TO_NUE).applyMatrix4(D);
    worst = Math.max(worst, got.distanceTo(truth));
  }
  return worst;
}

function walkingJump(dtMs: number, rateDegS: number): RelocalizationJump {
  const t0 = 10;
  const dtS = dtMs / 1000;
  return {
    t: (t0 + 2 * dtS) * 1000,
    tLast: (t0 + dtS) * 1000,
    lastPose: fromThree(walkingCamera(t0 + dtS, rateDegS)),
    tPrev: t0 * 1000,
    prevPose: fromThree(walkingCamera(t0, rateDegS)),
    newPose: fromThree(
      JUMP.clone().multiply(walkingCamera(t0 + 2 * dtS, rateDegS))
    ),
  };
}

describe('ar-space-correction', () => {
  it('compensates by default', () => {
    // Why this test matters: the default is a decision (the frame before
    // the jump is up to one frame stale); flipping it silently would move
    // every corrected object by the camera's own motion.
    expect(COMPENSATE_CAMERA_MOTION).toBe(true);
  });

  describe('camera-motion compensation sweep (frame dt x head rate)', () => {
    // Why this test matters: it measures what the compensation buys on a
    // walking, head-turning user whose motion is NOT exactly the model's
    // (the lens runs on an arc about the neck). Parameters swept: the frame
    // interval 33/100/200/500 ms and the head rate 10/30 deg/s; residuals
    // at 10 m and 50 m from the camera. The bound 0.05 m holds across the
    // whole range; uncompensated D is worse at every point of it.
    const rows: string[] = [];
    for (const dtMs of [33, 100, 200, 500]) {
      for (const rateDegS of [10, 30]) {
        it(`dt ${dtMs} ms, ${rateDegS} deg/s`, () => {
          const jump = walkingJump(dtMs, rateDegS);
          const cam = new THREE.Vector3().setFromMatrixPosition(
            walkingCamera(10 + (2 * dtMs) / 1000, rateDegS)
          );
          const comp = jumpTransform(jump, true);
          const plain = jumpTransform(jump, false);
          const r = [10, 50].map((radius) => ({
            radius,
            comp: residualAt(comp, cam, radius),
            plain: residualAt(plain, cam, radius),
          }));
          rows.push(
            `dt=${dtMs}ms rate=${rateDegS}deg/s ` +
              r
                .map(
                  (x) =>
                    `@${x.radius}m comp=${x.comp.toExponential(2)} plain=${x.plain.toFixed(3)}`
                )
                .join(' ')
          );
          for (const x of r) {
            expect(x.comp).toBeLessThan(0.05);
            expect(x.comp).toBeLessThan(x.plain);
          }
        });
      }
    }
    it('reports the table', () => {
      console.info(`compensation sweep:\n${rows.join('\n')}`);
      expect(rows).toHaveLength(8);
    });
  });

  it(`falls back to the uncompensated D beyond ${MAX_EXTRAPOLATION_RATIO} measured intervals`, () => {
    // Why this test matters: a velocity from one short interval stretched
    // over a long gap amplifies its noise; past the cap the plain D is the
    // safer answer, and the cap must actually switch.
    const base = walkingJump(33, 30);
    const far: RelocalizationJump = {
      ...base,
      t:
        base.tLast + (base.tLast - base.tPrev!) * (MAX_EXTRAPOLATION_RATIO + 1),
    };
    const near: RelocalizationJump = {
      ...base,
      t: base.tLast + (base.tLast - base.tPrev!) * MAX_EXTRAPOLATION_RATIO,
    };
    expect(jumpTransform(far, true)).toEqual(jumpTransform(far, false));
    expect(jumpTransform(near, true)).not.toEqual(jumpTransform(near, false));
  });

  it('U4: an object between two jumps receives only the later D; one before both receives their product in order', () => {
    // Why this test matters: the two concrete cases the plan names, with
    // non-commuting jumps so a reversed order cannot pass.
    const d0: Pose = {
      position: [1, 0, 0],
      rotation: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)],
    };
    const d1: Pose = { position: [0, 0, 2], rotation: [0, 0, 0, 1] };
    const track = correctionTrack([d0, d1]);
    const x = new THREE.Vector3(1, 0, 0);
    expect(x.clone().applyMatrix4(matrixOf(track[2]!))).toEqual(x);
    const between = x.clone().applyMatrix4(matrixOf(track[1]!));
    expect(between.distanceTo(new THREE.Vector3(1, 0, 2))).toBeLessThan(1e-12);
    // First d0 (90 deg about Y: (1,0,0) -> (0,0,-1), then +1 x), then d1.
    const before = x.clone().applyMatrix4(matrixOf(track[0]!));
    expect(before.distanceTo(new THREE.Vector3(1, 0, 1))).toBeLessThan(1e-12);
  });

  it('epochAt refuses a NaN capture time and counts an empty list as epoch 0', () => {
    // Why this test matters: a tile without a capture time must not be
    // silently placed in some epoch; the caller decides what it means.
    expect(() => epochAt([1, 2], Number.NaN)).toThrow(TypeError);
    expect(epochAt([], 5)).toBe(0);
    expect(epochAt([1, 2], Number.POSITIVE_INFINITY)).toBe(2);
  });

  it('shownLocalMatrix is P^-1 * Delta * P * X_raw, and identity Delta leaves X_raw', () => {
    // Why this test matters: a child of the basis node (P not identity)
    // must receive Delta conjugated into its parent's frame; skipping P^-1
    // would move it by the basis itself.
    const P = WEBXR_TO_NUE.clone();
    const xRaw = new THREE.Matrix4().makeTranslation(1, 2, 3);
    const delta: Pose = {
      position: [0.5, 0, -1],
      rotation: [0, 0.2588190451, 0, 0.9659258263],
    };
    const got = shownLocalMatrix(delta, P.toArray(), xRaw.toArray());
    const expected = P.clone()
      .invert()
      .multiply(matrixOf(delta))
      .multiply(P)
      .multiply(xRaw);
    got.forEach((v, i) =>
      expect(Math.abs(v - expected.elements[i]!)).toBeLessThan(1e-12)
    );
    expect(
      shownLocalMatrix(IDENTITY_POSE, P.toArray(), xRaw.toArray())
    ).toEqual(xRaw.toArray());
    expect(() =>
      shownLocalMatrix(
        IDENTITY_POSE,
        new THREE.Matrix4().makeScale(0, 1, 1).toArray(),
        xRaw.toArray()
      )
    ).toThrow(RangeError);
  });
});
