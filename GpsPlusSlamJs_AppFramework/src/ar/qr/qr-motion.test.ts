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
import { solveQrPoseMultiView } from './qr-multi-view-pose';
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
  opts: { sigmaPx?: number; seed?: number; extent?: number } = {}
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
    extent: opts.extent ?? 30,
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

describe('measureQrMotion and the printed size', () => {
  // Why this test matters: a view's position from its corners scales with
  // the size the solve assumes, pulling it toward its CAMERA - so with a
  // wrong size a camera walking past a still code moves the code's
  // positions, and fast enough that reads as "moving". The producer's raw
  // poses are solved at the measured size (the demo measures it from
  // depth), so the detector takes its positions from them.
  // The camera sweeps 60 deg in 8 detections: 16 cm per detection.
  const fast = () => scene(8, () => codeAt(0, 5), { extent: 60 });

  it('reads a still code as still whatever size it assumes, from the raw poses', () => {
    for (const sizeM of [0.08, 0.12, 0.16, 0.24, 0.32]) {
      expect(measureQrMotion(fast(), { sizeM }).movingCandidate).toBe(false);
    }
  });

  // Without raw poses it can only use its own solve at its assumed size.
  // Pinned so the limitation is visible, not mistaken for the above.
  it('without raw poses, depends on the size it assumes', () => {
    const noRaw = fast().map((e) => ({ ...e, rawPose: null }));
    expect(measureQrMotion(noRaw, { sizeM: 0.16 }).movingCandidate).toBe(false);
    expect(measureQrMotion(noRaw, { sizeM: 0.08 }).movingCandidate).toBe(true);
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
    // One moving detection (index 6), read 5 times: not confirmed.
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

describe('createQrMotionTracker edge cases (milestone review 2026-09-25)', () => {
  // The store rebuilds every entry object when its detections array
  // changes (a prune, a history cap) without a new detection; the corners
  // are passed through by reference. Such a re-read is not a detection.
  it('does not count a rebuilt copy of the same detection again', () => {
    const tracker = createQrMotionTracker();
    const entries = scene(12, (i) =>
      i < 6 ? codeAt(0, 5) : codeAt(0.05 * (i - 5), 5)
    );
    let state = 'still';
    for (let i = 1; i <= 7; i++) {
      for (let r = 0; r < 5; r++) {
        const copy = entries.slice(0, i).map((e) => ({ ...e }));
        state = tracker.update(copy).state;
      }
    }
    expect(state).toBe('still');
  });

  // A reading with no signal (a failed solve, an unusable view in the
  // motion window) says nothing about motion: it must not vote "still"
  // and end a confirmed motion.
  it('keeps a confirmed motion through readings without a signal', () => {
    let failing = false;
    const tracker = createQrMotionTracker({
      solve: (views, sizeM, options) =>
        failing ? null : solveQrPoseMultiView(views, sizeM, options),
    });
    const entries = scene(18, (i) => codeAt(0.05 * i, 5));
    const states: string[] = [];
    for (let i = 1; i <= entries.length; i++) {
      failing = i >= 10 && i < 15;
      states.push(tracker.update(entries.slice(0, i)).state);
    }
    expect(states[8]).toBe('moving');
    expect(states.slice(8).every((st) => st === 'moving')).toBe(true);
  });

  // A clock going backwards in one epoch (a replay seek, a store swap) is
  // a new run: a stillSinceMs from the old run would sit in the future of
  // the new timestamps and cut every later window to nothing.
  it('starts afresh when the newest detection is older than the last', () => {
    const tracker = createQrMotionTracker();
    const moved = scene(20, (i) =>
      i < 8 ? codeAt(0.05 * i, 5) : codeAt(0.05 * 7, 5)
    );
    for (let i = 1; i <= moved.length; i++) tracker.update(moved.slice(0, i));
    const again = scene(4, () => codeAt(0, 5));
    const m = tracker.update(again);
    expect(m.state).toBe('still');
    expect(m.stillSinceMs).toBeNull();
  });

  // stillSinceMs says since when the code has been STILL; while it moves
  // again there is no such time.
  it('reports no still time while the code moves again', () => {
    const tracker = createQrMotionTracker();
    const entries = scene(34, (i) =>
      i < 8
        ? codeAt(0.05 * i, 5)
        : i < 20
          ? codeAt(0.35, 5)
          : codeAt(0.35 + 0.05 * (i - 19), 5)
    );
    const out = entries.map((_, i) => tracker.update(entries.slice(0, i + 1)));
    expect(out[19]!.state).toBe('still');
    expect(out[19]!.stillSinceMs).not.toBeNull();
    const last = out[out.length - 1]!;
    expect(last.state).toBe('moving');
    expect(last.stillSinceMs).toBeNull();
  });

  // The turn rate compares the newest rotation with the others' (centred
  // about two detections back), so it divides by that time span - like the
  // speed - not by one detection's (which read 97 deg/s here). It stays
  // ROUGH: the others' joint rotation sits ~12 deg behind, not 10, so a
  // steady 40 deg/s reads ~49 (measured 2026-09-25). Display only.
  it('reads a steady in-plane turn at its rate', () => {
    // 5 deg per 125 ms = 40 deg/s.
    const m = measureQrMotion(scene(8, (i) => codeAt(0, 5, 5 * i)));
    expect(m.turnRateDegPerS!).toBeGreaterThan(34);
    expect(m.turnRateDegPerS!).toBeLessThan(52);
  });
});

describe('measureQrMotion window gap (PR #497 review)', () => {
  // The motion window must break at the same time gap as the fused window
  // it cuts: comparing the newest detection with ones from before a long
  // pause would read a code carried away meanwhile as a jump.
  const gapped = () =>
    scene(6, () => codeAt(0, 5)).map((e, i) => ({
      ...e,
      timestamp: e.timestamp + (i === 5 ? 2000 : 0),
    }));

  it('breaks at its gapMs', () => {
    expect(measureQrMotion(gapped()).offsetM).not.toBeNull();
    expect(measureQrMotion(gapped(), { gapMs: 1000 }).offsetM).toBeNull();
  });
});

describe('measureQrMotion code size on screen (plan §34 R1)', () => {
  // Field tests read the signals per size band: the newest view's mean
  // edge length comes with every reading.
  it('reports the newest view edge length in px', () => {
    const entries = scene(6, () => codeAt(0, 5));
    const m = measureQrMotion(entries);
    const c = entries[entries.length - 1]!.corners;
    const edge =
      (Math.hypot(c[1]!.x - c[0]!.x, c[1]!.y - c[0]!.y) +
        Math.hypot(c[2]!.x - c[1]!.x, c[2]!.y - c[1]!.y) +
        Math.hypot(c[3]!.x - c[2]!.x, c[3]!.y - c[2]!.y) +
        Math.hypot(c[0]!.x - c[3]!.x, c[0]!.y - c[3]!.y)) /
      4;
    expect(m.newestEdgePx).toBeCloseTo(edge, 9);
    // A 16 cm code at 1.2 m with fx 820: about 109 px.
    expect(m.newestEdgePx!).toBeGreaterThan(95);
    expect(m.newestEdgePx!).toBeLessThan(125);
  });

  it('reports it even without a motion signal, and null without entries', () => {
    expect(
      measureQrMotion(scene(1, () => codeAt(0, 5))).newestEdgePx
    ).not.toBeNull();
    expect(measureQrMotion([]).newestEdgePx).toBeNull();
  });
});

describe('motion detector with corner-order flips (plan §39 F0c)', () => {
  // Pins what TODAY's detector does with flipped frames on a still code.
  const shift = (c: readonly Point2[], k: number): Point2[] =>
    [0, 1, 2, 3].map((i) => c[(i + k) % 4]!);
  const states = (run: number, k: number) => {
    const entries = scene(20, () => codeAt(0, 5), {
      sigmaPx: 0.5,
      seed: 5,
    }).map((e, i) =>
      i >= 10 && i < 10 + run ? { ...e, corners: shift(e.corners, k) } : e
    );
    const t = createQrMotionTracker();
    return entries.map((_, i) => t.update(entries.slice(0, i + 1)));
  };

  it('absorbs a one-frame flip (a single candidate, never confirmed)', () => {
    for (const k of [1, 2, 3]) {
      const out = states(1, k);
      expect(out.filter((m) => m.turningCandidate)).toHaveLength(1);
      expect(out.every((m) => m.state === 'still')).toBe(true);
    }
  });

  // KNOWN DEFECT (probe 2026-09-25): a two-frame flip gives FOUR turning
  // candidates in a row - the two flipped frames, then two clean frames
  // judged against a rest that holds them - so a still code reads
  // "turning" for ~0.5 s and the fused window is cut. A fix must make
  // this pass.
  it.fails('keeps a still code still through a two-frame flip', () => {
    for (const k of [1, 2, 3]) {
      expect(states(2, k).every((m) => m.state === 'still')).toBe(true);
    }
  });
});
