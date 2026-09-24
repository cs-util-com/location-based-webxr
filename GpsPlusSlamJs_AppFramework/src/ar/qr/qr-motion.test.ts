/**
 * The QR motion detector (QR near-frontal pose plan §26): per code and
 * independently, whether it is being MOVED and whether it is being TURNED,
 * from the same joint solve the fused window uses.
 *
 * Why these tests matter: the fused pose combines views as if the code were
 * still. A hand-held code breaks that, and the owner wants the four states
 * (still, moving, turning, moving + turning) told apart reliably - above all
 * a still code must read "still" while the CAMERA walks around it, or every
 * static anchor would lose its fused pose.
 */
import { describe, expect, it } from 'vitest';
import type { CameraIntrinsics, Point2, Pose } from './qr-pose';
import {
  buildObjectPoints,
  projectViewPoint,
  rotateVectorByQuaternion,
  solveQrPose,
} from './qr-pose';
import { PlanarPnpSquare } from './planar-pnp';
import type { QrFusedEntry } from './qr-fused-window';
import { createQrMotionTracker, measureQrMotion } from './qr-motion';
import { walkCameraPoses } from '../../test-utils/synthetic-qr-walk';
import { mulberry32 } from '../../test-utils/elevation-offset-scenarios';

const SIZE_M = 0.16;
const K: CameraIntrinsics = { fx: 820, fy: 820, cx: 512, cy: 384 };
const STEP_MS = 125;

function qmul(a: readonly number[], b: readonly number[]): Pose['rotation'] {
  return [
    a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!,
    a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!,
    a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!,
  ];
}

/** A rotation of `deg` about the unit axis `[x, y, z]`. */
function axisAngle(
  axis: [number, number, number],
  deg: number
): Pose['rotation'] {
  const h = (deg * Math.PI) / 360;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

/**
 * A code at `x` (m, sideways), yawed `yawDeg` about the vertical, and
 * spun `spinDeg` in its own plane (about its normal) - the in-plane turn a
 * hand gives it, which moves the corners at first order.
 */
function codeAt(x: number, yawDeg: number, spinDeg = 0): Pose {
  return {
    position: [x, 1.5, 0],
    rotation: qmul(axisAngle([0, 1, 0], yawDeg), axisAngle([0, 0, 1], spinDeg)),
  };
}

function corners(camera: Pose, code: Pose, noise?: () => number): Point2[] {
  const inv: Pose['rotation'] = [
    -camera.rotation[0],
    -camera.rotation[1],
    -camera.rotation[2],
    camera.rotation[3],
  ];
  return buildObjectPoints(SIZE_M).map((p) => {
    const w = rotateVectorByQuaternion(code.rotation, p);
    const c = projectViewPoint(
      rotateVectorByQuaternion(inv, [
        w[0] + code.position[0] - camera.position[0],
        w[1] + code.position[1] - camera.position[1],
        w[2] + code.position[2] - camera.position[2],
      ]),
      K
    )!;
    return noise ? { x: c.x + noise(), y: c.y + noise() } : c;
  });
}

/**
 * Entries of a scene: the camera walks an arc around the origin code
 * position while the code follows `codeOf(step)`.
 */
function scene(
  steps: number,
  codeOf: (i: number) => Pose,
  opts: { sigmaPx?: number; seed?: number } = {}
): QrFusedEntry[] {
  const rand = mulberry32(opts.seed ?? 1);
  const noise =
    opts.sigmaPx === undefined
      ? undefined
      : () =>
          opts.sigmaPx! *
          Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) *
          Math.cos(2 * Math.PI * rand());
  const cams = walkCameraPoses({
    kind: 'arc',
    codeWorld: codeAt(0, 0),
    distanceM: 1.2,
    extent: 30,
    steps,
  });
  return cams.map((cam, i) => {
    const code = codeOf(i);
    const c = corners(cam, code, noise);
    const raw = solveQrPose({
      imagePoints: c,
      sizeM: SIZE_M,
      intrinsics: K,
      cameraPose: cam,
      solver: new PlanarPnpSquare(),
      maxReprojectionErrorPx: Infinity,
    });
    return {
      timestamp: i * STEP_MS,
      corners: c,
      cameraPose: cam,
      intrinsics: K,
      rawPose: raw ? raw.qrPoseWorld : null,
    };
  });
}

describe('measureQrMotion (one detection, no persistence)', () => {
  // The camera walks, the code stays: both signals quiet.
  it('reads a still code as still while the camera walks around it', () => {
    const m = measureQrMotion(scene(8, () => codeAt(0, 5), { sigmaPx: 0.5 }));
    expect(m.movingCandidate).toBe(false);
    expect(m.turningCandidate).toBe(false);
    expect(m.speedMps!).toBeLessThan(0.02);
  });

  it('reads a sideways move as moving, not turning', () => {
    // 0.4 m/s: 5 cm per detection.
    const m = measureQrMotion(scene(8, (i) => codeAt(0.05 * i, 5)));
    expect(m.movingCandidate).toBe(true);
    expect(m.turningCandidate).toBe(false);
    expect(m.speedMps!).toBeCloseTo(0.4, 1);
  });

  it('reads a turn in place as turning, not moving', () => {
    // Spun in its own plane at 40 deg/s: 5 deg per detection.
    const m = measureQrMotion(scene(8, (i) => codeAt(0, 5, 5 * i)));
    expect(m.turningCandidate).toBe(true);
    expect(m.movingCandidate).toBe(false);
  });

  it('reads a move while turning as both', () => {
    const m = measureQrMotion(scene(8, (i) => codeAt(0.05 * i, 5, 5 * i)));
    expect(m.movingCandidate).toBe(true);
    expect(m.turningCandidate).toBe(true);
  });

  it('has nothing to say about fewer than two usable detections', () => {
    const m = measureQrMotion(scene(1, () => codeAt(0, 5)));
    expect(m.movingCandidate).toBe(false);
    expect(m.turningCandidate).toBe(false);
    expect(m.speedMps).toBeNull();
  });
});

describe('measureQrMotion limits', () => {
  // A known PHYSICAL limit, pinned so it is not mistaken for a bug: turning
  // the code OUT of the image plane near head-on moves its corners only at
  // second order (the reason its tilt is hard to measure), so a slow such
  // turn is not seen. Once oblique, the same turn moves the corners at first
  // order and is seen. The sweep measures where the boundary lies.
  it('sees an out-of-plane turn once the code is oblique', () => {
    const m = measureQrMotion(scene(8, (i) => codeAt(0, 30 + 8 * i)));
    expect(m.turningCandidate).toBe(true);
  });
});

describe('createQrMotionTracker (persistence, owner §26: ~0.5 s)', () => {
  // A state must show in 4 consecutive detections before the mode changes,
  // in both directions - one noisy frame (a corner-order flip) must not
  // flip the mode.
  it('switches to moving only after 4 consecutive moving detections', () => {
    const tracker = createQrMotionTracker();
    const entries = scene(14, (i) =>
      i < 6 ? codeAt(0, 5) : codeAt(0.05 * (i - 5), 5)
    );
    const states = entries.map(
      (_, i) => tracker.update(entries.slice(0, i + 1)).state
    );
    expect(states.slice(0, 8).every((s) => s === 'still')).toBe(true);
    expect(states[states.length - 1]).toBe('moving');
    // Not before the 4th consecutive moving detection.
    const firstMoving = states.indexOf('moving');
    expect(firstMoving).toBeGreaterThanOrEqual(6 + 3);
  });

  it('returns to still only after 4 consecutive still detections', () => {
    const tracker = createQrMotionTracker();
    const entries = scene(20, (i) =>
      i < 8 ? codeAt(0.05 * i, 5) : codeAt(0.05 * 7, 5)
    );
    const states = entries.map(
      (_, i) => tracker.update(entries.slice(0, i + 1)).state
    );
    expect(states[8]).toBe('moving');
    expect(states[states.length - 1]).toBe('still');
    const stillAgain = states.indexOf('still', 8);
    expect(stillAgain).toBeGreaterThanOrEqual(8 + 3);
  });

  it('ignores a single outlier detection', () => {
    const tracker = createQrMotionTracker();
    const entries = scene(12, (i) =>
      i === 6 ? codeAt(0.2, 5, 40) : codeAt(0, 5)
    );
    const states = entries.map(
      (_, i) => tracker.update(entries.slice(0, i + 1)).state
    );
    expect(states.every((s) => s === 'still')).toBe(true);
  });

  // The owner's first constraint (§26): a still code keeps today's
  // stability. Measured 2026-09-25 over 10 seeds x 40 detections: at 1 px
  // of corner noise a few SINGLE detections cross the thresholds and the
  // persistence absorbs every one; from 1.5 px a few runs leak (2/400 at
  // persistence 4) and at 2 px it breaks - the phone test decides where
  // real corners sit (plan §26).
  it('keeps a still code still under 1 px of corner noise', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const tracker = createQrMotionTracker();
      const entries = scene(40, () => codeAt(0, 5), { sigmaPx: 1, seed });
      for (let i = 1; i <= entries.length; i++) {
        expect(tracker.update(entries.slice(0, i)).state).toBe('still');
      }
    }
  });

  // The demo re-reads on every HUD render: the same newest detection must
  // not count twice toward the persistence.
  it('steps once per detection, however often it is read', () => {
    const tracker = createQrMotionTracker();
    const entries = scene(12, (i) =>
      i < 6 ? codeAt(0, 5) : codeAt(0.05 * (i - 5), 5)
    );
    let state = 'still';
    for (let i = 1; i <= 7; i++) {
      for (let r = 0; r < 5; r++)
        state = tracker.update(entries.slice(0, i)).state;
    }
    // Two moving detections (6, 7), read 5 times each: still not confirmed.
    expect(state).toBe('still');
  });

  it('reports the time the code has been still since', () => {
    const tracker = createQrMotionTracker();
    const entries = scene(20, (i) =>
      i < 8 ? codeAt(0.05 * i, 5) : codeAt(0.05 * 7, 5)
    );
    let last = tracker.update(entries.slice(0, 1));
    for (let i = 2; i <= entries.length; i++)
      last = tracker.update(entries.slice(0, i));
    expect(last.state).toBe('still');
    // Still from the first detection of the confirming run on.
    expect(last.stillSinceMs).toBeGreaterThanOrEqual(7 * STEP_MS);
    expect(last.stillSinceMs).toBeLessThanOrEqual(10 * STEP_MS);
  });
});
