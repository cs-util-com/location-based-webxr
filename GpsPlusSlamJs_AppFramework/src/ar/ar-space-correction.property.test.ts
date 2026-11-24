/**
 * Property tests for the pure AR-space correction math.
 *
 * The oracle is three.js (an independent implementation of the same rigid
 * algebra), never the module's own helpers, so a convention slip in the
 * module (multiplication order, a basis applied on the wrong side) cannot
 * confirm itself.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import type { Pose } from './qr/qr-pose';
import { WEBXR_TO_NUE } from './webxr-nue-basis';
import {
  MAX_COMPENSATION_GAP_MS,
  correctionTrack,
  epochAt,
  jumpTransform,
  poseToMatrix4,
  type RelocalizationJump,
} from './ar-space-correction';

const num = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const unitQuaternion = fc
  .tuple(num(-1, 1), num(-1, 1), num(-1, 1), num(-1, 1))
  .filter(([x, y, z, w]) => Math.hypot(x, y, z, w) > 0.1)
  .map(([x, y, z, w]): [number, number, number, number] => {
    const n = Math.hypot(x, y, z, w);
    return [x / n, y / n, z / n, w / n];
  });

const pose = fc.record({
  position: fc.tuple(num(-50, 50), num(-5, 5), num(-50, 50)),
  rotation: unitQuaternion,
});

const point = fc.tuple(num(-60, 60), num(-10, 10), num(-60, 60));

const toThree = (p: Pose): THREE.Matrix4 =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...p.position),
    new THREE.Quaternion(...p.rotation),
    new THREE.Vector3(1, 1, 1)
  );

const fromThree = (m: THREE.Matrix4): Pose => {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  m.decompose(position, rotation, new THREE.Vector3());
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  };
};

/** Apply a module pose (via its matrix form) to a point. */
const applyModule = (
  d: Pose,
  x: readonly [number, number, number]
): THREE.Vector3 =>
  new THREE.Vector3(...x).applyMatrix4(
    new THREE.Matrix4().fromArray([...poseToMatrix4(d)])
  );

/** A raw WebXR point mapped into O (odometry NUE) by the basis. */
const toO = (x: THREE.Vector3): THREE.Vector3 =>
  x.clone().applyMatrix4(WEBXR_TO_NUE);

describe('ar-space-correction (properties)', () => {
  it('a camera that does not move while its frame jumps yields D mapping every old-frame point onto its new-frame coordinates', () => {
    // Why this test matters: D is the whole correction. If its order
    // (P_a * P_b^-1, not P_b^-1 * P_a) or its basis conjugation were wrong,
    // every corrected object would land somewhere plausible but wrong, and
    // only a field test would show it.
    fc.assert(
      fc.property(pose, pose, point, (camera, jump, x) => {
        const J = toThree(jump);
        const lastPose = camera;
        const newPose = fromThree(J.clone().multiply(toThree(camera)));
        const obs: RelocalizationJump = {
          t: 1000,
          tLast: 967,
          lastPose,
          tPrev: null,
          prevPose: null,
          newPose,
        };
        const d = jumpTransform(obs);
        const oldInO = toO(new THREE.Vector3(...x));
        const expected = toO(new THREE.Vector3(...x).applyMatrix4(J));
        const got = applyModule(d, [oldInO.x, oldInO.y, oldInO.z]);
        expect(got.distanceTo(expected)).toBeLessThan(1e-9);
      })
    );
  });

  it('a camera moving and turning at constant rates through the jump gives a compensated D that recovers the frame switch', () => {
    // Why this test matters: between the frame before the jump and the jump
    // frame the camera itself moves (33 ms at 30 fps, longer after a stall).
    // Uncompensated, that motion is read as part of the jump and every old
    // object is moved by it. Under the constant-rate model the compensation
    // must remove it exactly. The gap to the jump frame is drawn apart from
    // the measured interval (ratio 0.5 to 4), so an inverted ratio fails.
    fc.assert(
      fc.property(
        pose,
        pose,
        fc.tuple(num(-2, 2), num(-0.5, 0.5), num(-2, 2)),
        fc.tuple(num(-1, 1), num(-1, 1), num(-1, 1)),
        num(-1, 1),
        num(0.01, 0.5),
        num(0.5, 4),
        point,
        (start, jump, velocity, axisRaw, rateRadS, dtS, ratio, x) => {
          fc.pre(Math.hypot(...axisRaw) > 0.1);
          // The compensation is used up to a 500 ms gap; past it, plain.
          fc.pre(ratio * dtS * 1000 <= MAX_COMPENSATION_GAP_MS);
          const axis = new THREE.Vector3(...axisRaw).normalize();
          const at = (tS: number): THREE.Matrix4 => {
            const q = new THREE.Quaternion()
              .setFromAxisAngle(axis, rateRadS * tS)
              .multiply(new THREE.Quaternion(...start.rotation));
            const p = new THREE.Vector3(...start.position).add(
              new THREE.Vector3(...velocity).multiplyScalar(tS)
            );
            return new THREE.Matrix4().compose(
              p,
              q,
              new THREE.Vector3(1, 1, 1)
            );
          };
          const J = toThree(jump);
          const tJumpS = dtS + ratio * dtS;
          const obs: RelocalizationJump = {
            t: tJumpS * 1000,
            tLast: dtS * 1000,
            lastPose: fromThree(at(dtS)),
            tPrev: 0,
            prevPose: fromThree(at(0)),
            newPose: fromThree(J.clone().multiply(at(tJumpS))),
          };
          const d = jumpTransform(obs, 'always');
          const oldInO = toO(new THREE.Vector3(...x));
          const expected = toO(new THREE.Vector3(...x).applyMatrix4(J));
          const got = applyModule(d, [oldInO.x, oldInO.y, oldInO.z]);
          expect(got.distanceTo(expected)).toBeLessThan(1e-8);
        }
      )
    );
  });

  it('a static camera gives the same compensated and uncompensated D', () => {
    // Why this test matters: the compensation is ON by default. With no
    // camera motion it must change nothing, or it would add its own error
    // to every jump observed while the phone is held still.
    fc.assert(
      fc.property(
        pose,
        pose,
        num(1, 400),
        num(1, 400),
        (camera, jump, dt1, dt2) => {
          const newPose = fromThree(toThree(jump).multiply(toThree(camera)));
          const base = {
            t: 10_000,
            tLast: 10_000 - dt2,
            lastPose: camera,
            newPose,
          };
          const compensated = jumpTransform({
            ...base,
            tPrev: 10_000 - dt2 - dt1,
            prevPose: camera,
          });
          const plain = jumpTransform({
            ...base,
            tPrev: null,
            prevPose: null,
          });
          const a = poseToMatrix4(compensated);
          const b = poseToMatrix4(plain);
          for (let i = 0; i < 16; i++) {
            expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(1e-9);
          }
        }
      )
    );
  });

  it('composition: Delta(e) equals applying every later jump in observation order', () => {
    // Why this test matters: an object of epoch e must receive every jump
    // after it, oldest first. A reversed product is only wrong when the
    // jumps do not commute, which random rotations guarantee here.
    fc.assert(
      fc.property(
        fc.array(pose, { minLength: 0, maxLength: 5 }),
        point,
        (jumps, x) => {
          const track = correctionTrack(jumps);
          expect(track).toHaveLength(jumps.length + 1);
          for (let e = 0; e <= jumps.length; e++) {
            const expected = new THREE.Vector3(...x);
            for (let j = e; j < jumps.length; j++) {
              expected.applyMatrix4(toThree(jumps[j]!));
            }
            const got = applyModule(track[e]!, x);
            expect(got.distanceTo(expected)).toBeLessThan(1e-8);
          }
        }
      )
    );
  });

  it('epochAt counts the observations at or before the capture time', () => {
    // Why this test matters: a tile captured before a jump but dispatched
    // after it must still be corrected, so its epoch comes from its capture
    // time. An item at exactly the jump time belongs to the new segment.
    fc.assert(
      fc.property(
        fc.array(num(0, 1e6), { maxLength: 20 }),
        num(-10, 1.1e6),
        (raw, capturedAt) => {
          const times = [...raw].sort((a, b) => a - b);
          const expected = times.filter((t) => t <= capturedAt).length;
          expect(epochAt(times, capturedAt)).toBe(expected);
          for (const t of times) {
            expect(epochAt(times, t)).toBe(times.filter((u) => u <= t).length);
          }
        }
      )
    );
  });
});
