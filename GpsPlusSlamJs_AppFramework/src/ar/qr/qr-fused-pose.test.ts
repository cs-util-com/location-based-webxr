/**
 * The fused QR pose window (QR near-frontal pose plan 2026-09-23-2314, M3b
 * b1, §19): which detections form the window, when the joint rotation may be
 * used (the joint-fit gate, §18), when it falls back to today's averaging,
 * and that a tracker solves once per new window.
 *
 * Why these tests matter: this is the one place every app's QR pose goes
 * through after M3b. A window that mixes two coordinate frames, two prints
 * or stale frames, a gate that one bad corner can trip, or an output that
 * jumps between methods, is what users would see as a jumping or wrong
 * marker.
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
import { solveQrPoseMultiView } from './qr-multi-view-pose';
import {
  createFusedQrPoseTracker,
  evaluateFusedQrPose,
  selectFusedWindow,
  type QrFusedEntry,
} from './qr-fused-pose';
import { walkCameraPoses } from '../../test-utils/synthetic-qr-walk';
import { rotationAngleDeg } from '../../test-utils/qr-zxing-pipeline';
import { mulberry32 } from '../../test-utils/elevation-offset-scenarios';

const SIZE_M = 0.16;
const K: CameraIntrinsics = { fx: 820, fy: 820, cx: 512, cy: 384 };

function tilted(deg: number): Pose {
  const h = (deg * Math.PI) / 360;
  return {
    position: [0, 1.5, 0],
    rotation: [0, Math.sin(h), 0, Math.cos(h)],
  };
}

/** Exact corners in double precision, optionally with Gaussian noise. */
function cornersOf(
  camera: Pose,
  code: Pose,
  noise?: { sigmaPx: number; rand: () => number }
): Point2[] {
  const inv: Pose['rotation'] = [
    -camera.rotation[0],
    -camera.rotation[1],
    -camera.rotation[2],
    camera.rotation[3],
  ];
  const g = () => {
    if (!noise) return 0;
    const u = Math.max(noise.rand(), 1e-12);
    return (
      noise.sigmaPx *
      Math.sqrt(-2 * Math.log(u)) *
      Math.cos(2 * Math.PI * noise.rand())
    );
  };
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
    return { x: c.x + g(), y: c.y + g() };
  });
}

/** An entry as a producer would record it, with its single-frame pose. */
function entryOf(
  camera: Pose,
  corners: Point2[],
  timestamp: number,
  epoch = 0
): QrFusedEntry {
  const raw = solveQrPose({
    imagePoints: corners,
    sizeM: SIZE_M,
    intrinsics: K,
    cameraPose: camera,
    solver: new PlanarPnpSquare(),
    maxReprojectionErrorPx: Infinity,
  });
  return {
    timestamp,
    corners,
    cameraPose: camera,
    intrinsics: K,
    epoch,
    rawPose: raw ? raw.qrPoseWorld : null,
  };
}

/** A walk's entries, 125 ms apart. */
function walkEntries(
  code: Pose,
  steps: number,
  opts: {
    extent?: number;
    offsetDeg?: number;
    noise?: { sigmaPx: number; rand: () => number };
    t0?: number;
  } = {}
): QrFusedEntry[] {
  return walkCameraPoses({
    kind: 'arc',
    codeWorld: code,
    distanceM: 1.2,
    extent: opts.extent ?? 30,
    steps,
    offsetDeg: opts.offsetDeg ?? 0,
  }).map((cam, i) =>
    entryOf(cam, cornersOf(cam, code, opts.noise), (opts.t0 ?? 0) + i * 125)
  );
}

describe('selectFusedWindow', () => {
  const base = walkEntries(tilted(5), 10);

  it('takes the newest entries up to the window size', () => {
    const w = selectFusedWindow(base, { windowSize: 4 });
    expect(w).toEqual(base.slice(6));
  });

  // The gap is measured between consecutive entries, on their own clock:
  // exactly gapMs still joins, anything longer starts a new window.
  it('cuts at a gap longer than gapMs, not at one equal to it', () => {
    const joined = base.map((e, i) => ({
      ...e,
      timestamp: i < 5 ? i * 100 : 400 + 1000 + (i - 5) * 100,
    }));
    expect(
      selectFusedWindow(joined, { gapMs: 1000, windowSize: 10 })
    ).toHaveLength(10);
    const split = joined.map((e, i) => ({
      ...e,
      timestamp: i < 5 ? e.timestamp : e.timestamp + 1,
    }));
    expect(selectFusedWindow(split, { gapMs: 1000, windowSize: 10 })).toEqual(
      split.slice(5)
    );
  });

  // A timestamp that goes BACKWARDS by more than the gap (a store swap, a
  // clock change) is a break too, not a free pass.
  it('treats a large backwards jump in time as a break', () => {
    const back = base.map((e, i) => ({
      ...e,
      timestamp: i < 5 ? 10_000 + i * 100 : i * 100,
    }));
    expect(selectFusedWindow(back, { gapMs: 1000, windowSize: 10 })).toEqual(
      back.slice(5)
    );
  });

  // After an odometry restart the old detections live in another coordinate
  // frame; only the newest epoch may be combined.
  it('keeps only the newest frame epoch', () => {
    const mixed = base.map((e, i) => ({ ...e, epoch: i < 7 ? 0 : 1 }));
    expect(selectFusedWindow(mixed, { windowSize: 10 })).toEqual(
      mixed.slice(7)
    );
  });

  // Two prints of one payload: only detections near the newest one's raw
  // position count; entries without a raw pose are kept (the filter cannot
  // judge them).
  it('keeps only entries within radiusM of the newest raw position', () => {
    const far = base.map((e, i) =>
      i === 8 && e.rawPose
        ? {
            ...e,
            rawPose: {
              ...e.rawPose,
              position: [
                e.rawPose.position[0] + 3,
                e.rawPose.position[1],
                e.rawPose.position[2],
              ] as Pose['position'],
            },
          }
        : i === 7
          ? { ...e, rawPose: null }
          : e
    );
    const w = selectFusedWindow(far, { windowSize: 10, radiusM: 0.5 });
    expect(w).toContain(far[7]);
    expect(w).not.toContain(far[8]);
    expect(w).toContain(far[9]);
  });
});

describe('evaluateFusedQrPose', () => {
  it('is unknown without entries', () => {
    const r = evaluateFusedQrPose([]);
    expect(r.status).toBe('unknown');
    expect(r.pose).toBeNull();
  });

  // The joint-fit gate (§18): enough views AND a good fit.
  it('is stable from minViews well-fitting views, measuring below', () => {
    const code = tilted(5);
    const entries = walkEntries(code, 8);
    const few = evaluateFusedQrPose(entries.slice(0, 4), { minViews: 5 });
    expect(few.status).toBe('measuring');
    expect(few.method).toBe('joint');
    const enough = evaluateFusedQrPose(entries, { minViews: 5 });
    expect(enough.status).toBe('stable');
    expect(rotationAngleDeg(enough.pose!.rotation, code.rotation)).toBeLessThan(
      1e-3
    );
  });

  // The position is the median of the raw positions (today's), not the
  // solve's mean.
  it('takes the position as the median of the raw positions', () => {
    const code = tilted(5);
    const entries = walkEntries(code, 8);
    const r = evaluateFusedQrPose(entries);
    r.pose!.position.forEach((v, a) =>
      expect(Math.abs(v - code.position[a]!)).toBeLessThan(1e-4)
    );
  });

  // One bad corner in one view must not close the gate (§16 #6): the gate
  // reads the MEDIAN per-view error.
  it('stays stable with one bad corner in one view', () => {
    const code = tilted(5);
    const entries = walkEntries(code, 8);
    const bad = entries.map((e, i) =>
      i === 3
        ? {
            ...e,
            corners: [
              { x: e.corners[0]!.x + 25, y: e.corners[0]!.y },
              ...e.corners.slice(1),
            ],
          }
        : e
    );
    const r = evaluateFusedQrPose(bad, { maxFitPx: 1 });
    expect(r.status).toBe('stable');
    expect(r.method).toBe('joint');
  });

  // Old recordings (before the corner-order fix) can hold corners in mixed
  // orders: the views then contradict each other, the joint fit is bad, and
  // the output falls back to today's averaging instead of a nonsense fit.
  it('falls back to the averaged rotation when the views contradict each other', () => {
    const code = tilted(5);
    const entries = walkEntries(code, 8);
    const rolled = entries.map((e, i) =>
      i % 2 === 0
        ? {
            ...e,
            corners: [
              e.corners[1]!,
              e.corners[2]!,
              e.corners[3]!,
              e.corners[0]!,
            ],
          }
        : e
    );
    const r = evaluateFusedQrPose(rolled);
    expect(r.method).toBe('averaged');
    expect(r.status).toBe('measuring');
  });

  // Why this test matters (§16 #11): a window where the joint rotation and
  // the averaged one DIFFER, so a wiring that silently fell back would fail.
  it('returns the joint rotation where it differs from the averaged one', () => {
    const rand = mulberry32(3);
    const code = tilted(4);
    const entries = walkEntries(code, 8, {
      noise: { sigmaPx: 0.5, rand },
      extent: 30,
    });
    const r = evaluateFusedQrPose(entries);
    const joint = solveQrPoseMultiView(
      entries.map((e) => ({
        corners: e.corners,
        cameraPose: e.cameraPose,
        intrinsics: e.intrinsics,
      })),
      SIZE_M
    )!;
    expect(r.method).toBe('joint');
    // Component-wise: an acos-based angle cannot resolve below ~1e-6 deg.
    r.pose!.rotation.forEach((c, i) =>
      expect(Math.abs(c - joint.rotation[i]!)).toBeLessThan(1e-12)
    );
    expect(r.averagedRotationDeltaDeg).toBeGreaterThan(0.1);
  });

  // Hysteresis: once stable, a fit slightly above the bound keeps it stable,
  // so the output does not flicker between states frame to frame.
  it('stays stable through a fit just above the bound once stable', () => {
    const code = tilted(5);
    const entries = walkEntries(code, 8);
    const first = evaluateFusedQrPose(entries, { maxFitPx: 1 });
    expect(first.status).toBe('stable');
    const worse = { ...first, fitPx: 0 };
    // A window whose median view error sits between the bound and bound x
    // hysteresis: stable only when it was stable before.
    const rand = mulberry32(9);
    const noisy = walkEntries(code, 8, { noise: { sigmaPx: 1.1, rand } });
    const cold = evaluateFusedQrPose(noisy, { maxFitPx: 1, hysteresis: 2 });
    const warm = evaluateFusedQrPose(
      noisy,
      { maxFitPx: 1, hysteresis: 2 },
      worse
    );
    expect(cold.fitPx).toBeGreaterThan(1);
    expect(cold.fitPx).toBeLessThan(2);
    expect(cold.status).toBe('measuring');
    expect(warm.status).toBe('stable');
  });
});

describe('createFusedQrPoseTracker', () => {
  // Why this test matters (§16 #5): the apps read the pose on hot paths
  // (every XR frame in the TourViewer author view). The tracker must solve
  // once per NEW entries array, and never because time passed.
  it('solves once per new entries array', () => {
    let solves = 0;
    const tracker = createFusedQrPoseTracker({
      solve: (views, sizeM, options) => {
        solves++;
        return solveQrPoseMultiView(views, sizeM, options);
      },
    });
    const entries = walkEntries(tilted(5), 8);
    const a = tracker.evaluate(entries);
    const b = tracker.evaluate(entries);
    expect(solves).toBe(1);
    expect(b).toBe(a);
    const more = [...entries];
    tracker.evaluate(more);
    expect(solves).toBe(2);
  });

  // The tracker carries the previous result for the hysteresis.
  it('feeds its previous result into the next evaluation', () => {
    const code = tilted(5);
    const tracker = createFusedQrPoseTracker({ maxFitPx: 1, hysteresis: 2 });
    expect(tracker.evaluate(walkEntries(code, 8)).status).toBe('stable');
    const rand = mulberry32(9);
    expect(
      tracker.evaluate(walkEntries(code, 8, { noise: { sigmaPx: 1.1, rand } }))
        .status
    ).toBe('stable');
  });
});
