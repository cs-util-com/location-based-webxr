import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Pose } from './qr/qr-pose';
import { WEBXR_TO_NUE } from './webxr-nue-basis';
import {
  COMPENSATE_CAMERA_MOTION,
  IDENTITY_POSE,
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
function walkingCamera(
  tS: number,
  rateDegS: number,
  walkMS = WALK_M_S
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    THREE.MathUtils.degToRad(rateDegS * tS)
  );
  const neck = new THREE.Vector3(walkMS * tS, 1.6, 0);
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

interface Jitter {
  readonly rng: () => number;
  readonly posM: number;
  readonly rotDeg: number;
}

/**
 * A jump seen by a walking camera: the measured interval `tLast - tPrev` is
 * `dtMs`, the gap to the jump frame `t - tLast` is `ratio` times that.
 * `jitter` adds seeded noise to each of the three poses on its own.
 */
function walkingJump(
  dtMs: number,
  rateDegS: number,
  ratio = 1,
  jitter?: Jitter,
  walkMS = WALK_M_S
): RelocalizationJump {
  const t0 = 10;
  const dtS = dtMs / 1000;
  const tJump = t0 + dtS + ratio * dtS;
  const cam = (tS: number) => walkingCamera(tS, rateDegS, walkMS);
  const noisy = (m: THREE.Matrix4): Pose =>
    fromThree(jitter === undefined ? m : jittered(m, jitter));
  return {
    t: tJump * 1000,
    tLast: (t0 + dtS) * 1000,
    lastPose: noisy(cam(t0 + dtS)),
    tPrev: t0 * 1000,
    prevPose: noisy(cam(t0)),
    newPose: noisy(JUMP.clone().multiply(cam(tJump))),
  };
}

/** Seeded uniform [0, 1) generator (mulberry32), so a sweep is repeatable. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box-Muller). */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** `m` with Gaussian position noise and a Gaussian small-angle rotation. */
function jittered(m: THREE.Matrix4, j: Jitter): THREE.Matrix4 {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  m.decompose(p, q, new THREE.Vector3());
  const g = () => gaussian(j.rng);
  p.add(new THREE.Vector3(g(), g(), g()).multiplyScalar(j.posM));
  const r = THREE.MathUtils.degToRad(j.rotDeg);
  const axisAngle = new THREE.Vector3(g() * r, g() * r, g() * r);
  const angle = axisAngle.length();
  if (angle > 0) {
    q.premultiply(
      new THREE.Quaternion().setFromAxisAngle(axisAngle.normalize(), angle)
    );
  }
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
}

/**
 * Print a sweep table. The unit config runs silent, so the table is also
 * appended to the file named by AR_SPACE_SWEEP_OUT when that is set.
 */
function report(table: string): void {
  console.info(table);
  const out = process.env.AR_SPACE_SWEEP_OUT;
  if (out) appendFileSync(out, `${table}\n`);
}

const percentile = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
};

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
      report(`compensation sweep:\n${rows.join('\n')}`);
      expect(rows).toHaveLength(8);
    });
  });

  describe('extrapolation ratio sweep with seeded pose jitter', () => {
    // Why this test matters: the compensation stretches the velocity of one
    // measured interval over the gap to the jump frame. A long gap (a
    // stalled frame) amplifies the pose noise of that interval. This sweep
    // measures, per ratio (t - tLast) / (tLast - tPrev), the error of the
    // compensated and the plain D under seeded jitter, for a still user and
    // two walking ones, so a cap on the ratio is decided on numbers.
    // Parameters: measured interval 33 ms; ratios 1, 2, 4, 6, 10, 15, 30
    // and 45 (a gap of 500 ms is ratio 15 at 30 Hz, 30 at 60 Hz and 45 at
    // 90 Hz); jitter per pose (position sigma,
    // rotation sigma per axis) 0.5 mm / 0.01 deg, 1 mm / 0.05 deg and
    // 3 mm / 0.2 deg; 300 seeds per cell; residual at 10 m from the camera.
    // Verdict (no cap): beyond ratio 4 the compensation beats the plain D
    // for both walking users at every jitter level, and loses only for a
    // still user, who loses at ratios 1 to 4 as well. So the ratio does not
    // separate the cases a cap would serve; the camera's motion does.
    const RATIOS = [1, 2, 4, 6, 10, 15, 30, 45];
    const JITTERS = [
      { posM: 0.0005, rotDeg: 0.01 },
      { posM: 0.001, rotDeg: 0.05 },
      { posM: 0.003, rotDeg: 0.2 },
    ];
    const MOTIONS = [
      { name: 'still', walkMS: 0, rateDegS: 0 },
      { name: 'walk+10deg/s', walkMS: WALK_M_S, rateDegS: 10 },
      { name: 'walk+30deg/s', walkMS: WALK_M_S, rateDegS: 30 },
    ];
    const SEEDS = 300;
    it('reports compensated and plain error per ratio, jitter and motion', () => {
      const rows: string[] = [];
      for (const motion of MOTIONS) {
        for (const jitter of JITTERS) {
          for (const ratio of RATIOS) {
            const comp: number[] = [];
            const plain: number[] = [];
            const rng = seededRandom(1 + ratio * 1000 + jitter.rotDeg * 1e5);
            for (let s = 0; s < SEEDS; s++) {
              const jump = walkingJump(
                33,
                motion.rateDegS,
                ratio,
                { rng, ...jitter },
                motion.walkMS
              );
              const cam = new THREE.Vector3().setFromMatrixPosition(
                walkingCamera(jump.t / 1000, motion.rateDegS, motion.walkMS)
              );
              const c = jumpTransform(jump, true);
              const p = jumpTransform(jump, false);
              comp.push(residualAt(c, cam, 10));
              plain.push(residualAt(p, cam, 10));
            }
            const compP50 = percentile(comp, 0.5);
            const plainP50 = percentile(plain, 0.5);
            // A still camera favours the plain form; a moving one at a long
            // gap favours compensation; other cells are reported only.
            const better = compP50 < plainP50 ? 'comp' : 'plain';
            const pinned =
              motion.walkMS === 0 ? 'plain' : ratio > 4 ? 'comp' : better;
            expect(`${motion.name} ratio ${ratio}: ${better}`).toBe(
              `${motion.name} ratio ${ratio}: ${pinned}`
            );
            rows.push(
              `${motion.name} jitter=${jitter.posM * 1000}mm/${jitter.rotDeg}deg ` +
                `ratio=${ratio}: comp p50=${percentile(comp, 0.5).toFixed(3)} ` +
                `p95=${percentile(comp, 0.95).toFixed(3)} ` +
                `plain p50=${percentile(plain, 0.5).toFixed(3)} ` +
                `p95=${percentile(plain, 0.95).toFixed(3)}`
            );
          }
        }
      }
      report(`extrapolation ratio sweep (m at 10 m):\n${rows.join('\n')}`);
      expect(rows).toHaveLength(
        MOTIONS.length * JITTERS.length * RATIOS.length
      );
    });
  });

  it('extrapolates by (t - tLast) / (tLast - tPrev), not its inverse', () => {
    // Why this test matters: with equal intervals the ratio and its inverse
    // are both 1, so only unequal intervals tell them apart. Measured
    // interval 20 ms, gap 50 ms (ratio 2.5, inverse 0.4), a camera moving
    // and turning at constant rates: the compensation is exact only with
    // the right ratio; the inverse leaves centimetres.
    const at = (tMs: number): THREE.Matrix4 =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(1, 1.5, 0.5).multiplyScalar(tMs / 1000),
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          THREE.MathUtils.degToRad((60 * tMs) / 1000)
        ),
        new THREE.Vector3(1, 1, 1)
      );
    const jump: RelocalizationJump = {
      t: 70,
      tLast: 20,
      lastPose: fromThree(at(20)),
      tPrev: 0,
      prevPose: fromThree(at(0)),
      newPose: fromThree(JUMP.clone().multiply(at(70))),
    };
    const cam = new THREE.Vector3().setFromMatrixPosition(at(70));
    expect(residualAt(jumpTransform(jump), cam, 10)).toBeLessThan(1e-9);
    // The inverse ratio is what the camera pose at tLast + 0.4 * 20 ms gives.
    const inverse: RelocalizationJump = { ...jump, t: 28 };
    expect(residualAt(jumpTransform(inverse), cam, 10)).toBeGreaterThan(0.03);
  });

  it('uses the uncompensated D when tPrev is not before tLast', () => {
    // Why this test matters: equal times give no rate (a division by zero
    // would turn every corrected object into NaN); the pure function guards
    // it even though the slice refuses such an observation.
    const base = walkingJump(33, 30);
    const flat: RelocalizationJump = { ...base, tPrev: base.tLast };
    expect(jumpTransform(flat, true)).toEqual(jumpTransform(flat, false));
    const reversed: RelocalizationJump = { ...base, tPrev: base.tLast + 5 };
    expect(jumpTransform(reversed, true)).toEqual(
      jumpTransform(reversed, false)
    );
  });

  it('an object between two jumps receives only the later D; one before both receives their product in order', () => {
    // Why this test matters: the two concrete cases, with
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

describe('ar-space-correction quaternion handling', () => {
  /** A camera moving at 1 m/s and turning about a tilted axis at `degS`. */
  const turning = (degS: number) => (tMs: number) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(1, 0, 0.5).multiplyScalar(tMs / 1000),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0.3, 1, 0.2).normalize(),
        THREE.MathUtils.degToRad((degS * tMs) / 1000)
      ),
      new THREE.Vector3(1, 1, 1)
    );
  const jumpAt = (
    at: (tMs: number) => THREE.Matrix4,
    t: number
  ): RelocalizationJump => ({
    t,
    tLast: 20,
    lastPose: fromThree(at(20)),
    tPrev: 0,
    prevPose: fromThree(at(0)),
    newPose: fromThree(JUMP.clone().multiply(at(t))),
  });
  const maxDiff = (a: Pose, b: Pose): number => {
    const ma = matrixOf(a).elements;
    const mb = matrixOf(b).elements;
    return Math.max(...ma.map((v, i) => Math.abs(v - mb[i]!)));
  };
  const scaled = (q: Pose['rotation'], k: number): Pose['rotation'] => [
    q[0] * k,
    q[1] * k,
    q[2] * k,
    q[3] * k,
  ];

  it('q and -q are the same rotation: a step written in the other hemisphere extrapolates the short way', () => {
    // Why this test matters: a pose source may hand over either sign of the
    // same orientation. Raising the step quaternion to a fractional power
    // in the wrong hemisphere turns the long way round (or about the
    // reversed axis), so a half-frame gap (ratio 0.5) must give the same D
    // for both signs. An integer ratio would hide the difference.
    const jump = jumpAt(turning(90), 30);
    const flipped: RelocalizationJump = {
      ...jump,
      prevPose: {
        ...jump.prevPose!,
        rotation: scaled(jump.prevPose!.rotation, -1),
      },
    };
    expect(maxDiff(jumpTransform(flipped), jumpTransform(jump))).toBeLessThan(
      1e-12
    );
    const cam = new THREE.Vector3().setFromMatrixPosition(turning(90)(30));
    expect(residualAt(jumpTransform(flipped), cam, 10)).toBeLessThan(1e-9);
  });

  it('rotations that are not unit length are normalised before use', () => {
    // Why this test matters: a serialised pose can come back slightly or
    // grossly off unit length; scaling a quaternion must not scale the
    // matrix or the extrapolated turn.
    const jump = jumpAt(turning(45), 70);
    const off: RelocalizationJump = {
      ...jump,
      lastPose: {
        ...jump.lastPose,
        rotation: scaled(jump.lastPose.rotation, 3),
      },
      prevPose: {
        ...jump.prevPose!,
        rotation: scaled(jump.prevPose!.rotation, 0.5),
      },
      newPose: { ...jump.newPose, rotation: scaled(jump.newPose.rotation, 2) },
    };
    expect(maxDiff(jumpTransform(off), jumpTransform(jump))).toBeLessThan(
      1e-12
    );
    const d = jumpTransform(jump);
    expect(maxDiff({ ...d, rotation: scaled(d.rotation, 4) }, d)).toBeLessThan(
      1e-12
    );
  });

  it('a very small per-frame turn extrapolates to full precision', () => {
    // Why this test matters: a near-still camera turns by microradians per
    // frame, where acos(w) keeps only half the digits of the angle. With no
    // jump at all (the new pose is the extrapolated one), D must be the
    // identity to rounding, not to a few percent of the step.
    const at = turning(0.000005); // 1e-7 rad per 20 ms frame
    const still: RelocalizationJump = {
      ...jumpAt(at, 40),
      newPose: fromThree(at(40)),
    };
    const d = jumpTransform(still);
    const angle = 2 * Math.hypot(d.rotation[0], d.rotation[1], d.rotation[2]);
    expect(angle).toBeLessThan(1e-14);
  });
});
