/**
 * The recorder's level-mode votes on the fused QR pose (QR near-frontal pose
 * plan §71-§72, b6a).
 *
 * Why these tests matter: the recorder's votes rode each lock's single-frame
 * solve, which near head-on is several degrees off in tilt (plan §3), and
 * this alignment is what every OTHER code in the session is minted against.
 * The fused pose must be what votes, only once stable, at the level's
 * printed size (a wrong size moves a still code with the camera and reads
 * as motion), per detection (so a recording replays the same gate), and
 * never across a store swap or a tracking restart. The fixture is a real
 * slice fed with rendered corners plus 1 px of corner noise: at that noise
 * the newest view's single-frame solve is 1-8 deg off while the fused one
 * stays under 2 deg (probed over 200 seeds, 2026-09-26; at 0.5 px the
 * single-frame error drops to ~2 deg, too close to tell apart).
 */
import { describe, expect, it } from 'vitest';
import {
  buildObjectPoints,
  projectViewPoint,
  rotateVectorByQuaternion,
  solveQrPose,
  type Pose,
} from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import { PlanarPnpSquare } from 'gps-plus-slam-app-framework/ar/qr/planar-pnp';
import {
  qrDetectedReducer,
  recordQrDetection,
  type QrDetectedState,
} from 'gps-plus-slam-app-framework/state/qr-detected-slice';
import { createQrFusedVotes } from './qr-fused-votes';

const W = 1024;
const H = 768;
const K = { fx: 820, fy: 820, cx: 512, cy: 384 };
/** A WebXR projection whose intrinsics at W x H are exactly K. */
const PROJECTION = [
  (2 * K.fx) / W,
  0,
  0,
  0,
  0,
  (2 * K.fy) / H,
  0,
  0,
  1 - (2 * K.cx) / W,
  (2 * K.cy) / H - 1,
  -1.0002,
  -1,
  0,
  0,
  -0.2,
  0,
] as const;
const yaw = (deg: number): Pose['rotation'] => [
  0,
  Math.sin((deg * Math.PI) / 360),
  0,
  Math.cos((deg * Math.PI) / 360),
];
/** A code at the origin facing +z, turned 6 deg: near head-on from +z. */
const CODE: Pose = { position: [0, 0, 0], rotation: yaw(6) };

function angleDeg(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!
  );
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

/** A deterministic noise source in [-0.5, 0.5). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

/** A sideways walk 1.2 m in front of the code, recorded into a real slice. */
function walk(
  options: { sizeM?: number; noisePx?: number; seed?: number } = {}
) {
  const sizeM = options.sizeM ?? 0.16;
  const noisePx = options.noisePx ?? 0;
  const noise = lcg(options.seed ?? 1);
  let state: QrDetectedState = qrDetectedReducer(undefined, { type: '@@INIT' });
  let step = 0;
  return {
    getQrState: () => ({ qrDetected: state }),
    /** Record detection `i` of 8 (x from -0.3 to +0.3 m); its corners. */
    record(text = 'A') {
      const i = step++;
      const dx = -0.3 + (0.6 * (i % 8)) / 7;
      const cameraPose: Pose = {
        position: [dx, 0, 1.2],
        rotation: [0, 0, 0, 1],
      };
      const corners = buildObjectPoints(sizeM).map((p) => {
        const w = rotateVectorByQuaternion(CODE.rotation, p);
        const px = projectViewPoint([w[0] - dx, w[1], w[2] - 1.2], K)!;
        return {
          x: px.x + noise() * 2 * noisePx,
          y: px.y + noise() * 2 * noisePx,
        };
      });
      state = qrDetectedReducer(
        state,
        recordQrDetection({
          text,
          timestamp: 1000 + i * 125,
          corners,
          cameraPose,
          projectionMatrix: PROJECTION,
          imageWidth: W,
          imageHeight: H,
        })
      );
      return { corners, cameraPose, sizeM };
    },
    dispatch(action: { type: string }) {
      state = qrDetectedReducer(state, action);
    },
    swapToEmptyStore() {
      state = qrDetectedReducer(undefined, { type: '@@INIT' });
    },
  };
}

function votes(w: ReturnType<typeof walk>, spent = () => false) {
  const evaluated: string[] = [];
  const v = createQrFusedVotes({
    getQrState: w.getQrState,
    isSpent: spent,
    onEvaluated: (_r, text) => evaluated.push(text),
  });
  return { v, evaluated };
}

describe('createQrFusedVotes', () => {
  it('gives no pose before the level size is known, nor before the window is stable', () => {
    const w = walk();
    const { v, evaluated } = votes(w);
    for (let i = 0; i < 3; i++) {
      w.record();
      v.onRecorded('A');
    }
    // Fail closed: no size, no evaluation, no tracker at a default size.
    expect(evaluated).toEqual([]);
    expect(v.resolveStablePose('A')).toBeNull();
    v.noteLevelSize('A', 0.16);
    w.record();
    v.onRecorded('A');
    expect(v.resolveStablePose('A')).toBeNull(); // 4 views: too few
    for (let i = 0; i < 4; i++) {
      w.record();
      v.onRecorded('A');
    }
    expect(v.resolveStablePose('A')).not.toBeNull();
  });

  // 80 joint solves: ~0.3 s alone, but it hit the 5 s default under a
  // loaded machine's full run (2026-09-26), hence the explicit budget.
  it(
    'votes at the fused rotation where the newest single frame is off',
    { timeout: 30_000 },
    () => {
      const singles: number[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        const w = walk({ noisePx: 1, seed });
        const { v } = votes(w);
        v.noteLevelSize('A', 0.16);
        let last = w.record();
        v.onRecorded('A');
        for (let i = 1; i < 8; i++) {
          last = w.record();
          v.onRecorded('A');
        }
        const pose = v.resolveStablePose('A');
        expect(pose, `seed ${seed}`).not.toBeNull();
        expect(
          angleDeg(pose!.rotation, CODE.rotation),
          `seed ${seed}`
        ).toBeLessThan(2.5);
        // What the old wiring voted with: the newest lock's own solve.
        const single = solveQrPose({
          imagePoints: last.corners,
          sizeM: 0.16,
          intrinsics: K,
          cameraPose: last.cameraPose,
          solver: new PlanarPnpSquare(),
        });
        singles.push(angleDeg(single!.qrPoseWorld.rotation, CODE.rotation));
      }
      singles.sort((a, b) => a - b);
      expect(singles[5]!).toBeGreaterThan(3);
    }
  );

  // Plan §72 #4: a 0.25 m code judged at the 0.16 m default moves with the
  // walking camera and reads as motion; at its level size it is still.
  it("holds a walked-past code still at its level's size, and not at a wrong one", () => {
    for (const [sizeM, stable] of [
      [0.25, true],
      [0.16, false],
    ] as const) {
      const w = walk({ sizeM: 0.25 });
      const { v } = votes(w);
      v.noteLevelSize('A', sizeM);
      for (let i = 0; i < 8; i++) {
        w.record();
        v.onRecorded('A');
      }
      expect(v.resolveStablePose('A') !== null, `size ${sizeM}`).toBe(stable);
    }
  });

  it('evaluates once per recorded detection, and not at all once the budget is spent', () => {
    const w = walk();
    let spent = false;
    const { v, evaluated } = votes(w, () => spent);
    v.noteLevelSize('A', 0.16);
    for (let i = 0; i < 6; i++) {
      w.record();
      v.onRecorded('A');
    }
    expect(evaluated).toHaveLength(6);
    v.resolveStablePose('A'); // the lock's read: a cache hit
    expect(evaluated).toHaveLength(6);
    spent = true;
    w.record();
    v.onRecorded('A');
    expect(v.resolveStablePose('A')).toBeNull();
    expect(evaluated).toHaveLength(6);
  });

  // Plan §72 #1: the level is fetched once per AR session, often before
  // Start Recording; the new store's trackers must still get its size.
  it('keeps the level sizes across a store swap and starts fresh trackers', () => {
    const w = walk({ sizeM: 0.25 });
    const { v } = votes(w);
    v.noteLevelSize('A', 0.25);
    for (let i = 0; i < 8; i++) {
      w.record();
      v.onRecorded('A');
    }
    expect(v.resolveStablePose('A')).not.toBeNull();
    w.swapToEmptyStore();
    v.resetForStore();
    expect(v.resolveStablePose('A')).toBeNull();
    for (let i = 0; i < 8; i++) {
      w.record();
      v.onRecorded('A');
    }
    // Stable again: at the default 0.16 m this walk reads as motion.
    expect(v.resolveStablePose('A')).not.toBeNull();
  });

  // A tracker reads its code's size once, when created; only a fresh one
  // per store sees what is known now. Without the reset the old tracker
  // would judge the new store's walk at the size it started with.
  it('builds fresh trackers for the new store, which read the size again', () => {
    const w = walk({ sizeM: 0.25 });
    const { v } = votes(w);
    v.noteLevelSize('A', 0.16); // a wrong size first: the walk reads as motion
    for (let i = 0; i < 8; i++) {
      w.record();
      v.onRecorded('A');
    }
    expect(v.resolveStablePose('A')).toBeNull();
    v.noteLevelSize('A', 0.25);
    w.swapToEmptyStore();
    v.resetForStore();
    for (let i = 0; i < 8; i++) {
      w.record();
      v.onRecorded('A');
    }
    expect(v.resolveStablePose('A')).not.toBeNull();
  });

  // Plan §72 #6: the recorder's restart signal, not the demo's.
  it('stops voting at a tracking restart until the code is seen again', () => {
    const w = walk();
    const { v } = votes(w);
    v.noteLevelSize('A', 0.16);
    for (let i = 0; i < 8; i++) {
      w.record();
      v.onRecorded('A');
    }
    expect(v.resolveStablePose('A')).not.toBeNull();
    w.dispatch({ type: 'gpsData/odometryTrackingRestarted' });
    expect(v.resolveStablePose('A')).toBeNull();
  });

  it('ignores a missing or unusable size', () => {
    const w = walk();
    const { v, evaluated } = votes(w);
    for (const size of [undefined, 0, -1, Number.NaN, Infinity]) {
      v.noteLevelSize('A', size);
    }
    w.record();
    v.onRecorded('A');
    expect(evaluated).toEqual([]);
  });
});
