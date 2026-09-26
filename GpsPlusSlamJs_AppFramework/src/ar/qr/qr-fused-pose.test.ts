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
import { createFusedQrPoseTracker, evaluateFusedQrPose } from './qr-fused-pose';
import {
  ignoreNativeWhenOrdered,
  selectFusedWindow,
  type QrFusedEntry,
} from './qr-fused-window';
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
  frameEpoch = 0
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
    frameEpoch,
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
    const mixed = base.map((e, i) => ({ ...e, frameEpoch: i < 7 ? 0 : 1 }));
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

  // The radius anchor must not vanish when the NEWEST entry's own solve
  // failed (review §20 #4): it falls to the newest entry that has a raw pose.
  it('anchors the radius on the newest entry that has a raw pose', () => {
    const moved = (e: QrFusedEntry): QrFusedEntry => ({
      ...e,
      rawPose: {
        ...e.rawPose!,
        position: [
          e.rawPose!.position[0] + 3,
          e.rawPose!.position[1],
          e.rawPose!.position[2],
        ],
      },
    });
    const far = base.map((e, i) =>
      i === 9 ? { ...e, rawPose: null } : i === 5 ? moved(e) : e
    );
    const w = selectFusedWindow(far, { windowSize: 10, radiusM: 0.5 });
    expect(w).toContain(far[9]);
    expect(w).not.toContain(far[5]);
    expect(w).toContain(far[4]);
  });

  // Small out-of-order stamps (two frames delivered swapped) are not a gap.
  it('keeps small out-of-order timestamps together', () => {
    const swapped = base.map((e, i) => ({
      ...e,
      timestamp:
        i === 6
          ? base[7]!.timestamp
          : i === 7
            ? base[6]!.timestamp
            : e.timestamp,
    }));
    expect(selectFusedWindow(swapped, { windowSize: 10 })).toHaveLength(10);
  });

  // The motion detector's cut (plan §26): once a code stopped moving, only
  // the views since then may be fused.
  it('leaves out entries older than sinceMs', () => {
    const w = selectFusedWindow(base, { sinceMs: base[6]!.timestamp });
    expect(w).toEqual(base.slice(6));
  });

  // A NaN timestamp cannot be judged, so it breaks the window rather than
  // silently joining it.
  it('breaks the window at a NaN timestamp', () => {
    const bad = base.map((e, i) => ({
      ...e,
      timestamp: i === 6 ? Number.NaN : e.timestamp,
    }));
    expect(selectFusedWindow(bad, { windowSize: 10 })).toEqual(bad.slice(7));
  });

  // Plain JS callers can pass NaN or an explicit undefined; that must fall
  // back to the default, not switch the window off.
  it('treats invalid numeric options as their defaults', () => {
    expect(
      selectFusedWindow(base, {
        windowSize: Number.NaN,
        gapMs: undefined,
        radiusM: Number.NaN,
      })
    ).toEqual(base.slice(2));
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
    // Every raw pose 5 cm off along x: the joint solve's own position stays
    // at the truth, the output must follow the raw median.
    const entries = walkEntries(code, 8).map((e) => ({
      ...e,
      rawPose: {
        ...e.rawPose!,
        position: [
          e.rawPose!.position[0] + 0.05,
          e.rawPose!.position[1],
          e.rawPose!.position[2],
        ] as Pose['position'],
      },
    }));
    const r = evaluateFusedQrPose(entries);
    expect(r.pose!.position[0]).toBeCloseTo(code.position[0] + 0.05, 4);
    expect(r.pose!.position[1]).toBeCloseTo(code.position[1], 4);
  });

  // The gate's view count is inclusive: exactly minViews is enough.
  it('opens the gate at exactly minViews views', () => {
    const entries = walkEntries(tilted(5), 8);
    expect(
      evaluateFusedQrPose(entries.slice(0, 5), { minViews: 5 }).status
    ).toBe('stable');
  });

  // Without any raw pose there is nothing to fall back to: a contradicting
  // window gives no pose rather than a nonsense joint one.
  it('gives no pose when the fit is bad and no raw pose exists', () => {
    const entries = walkEntries(tilted(5), 8).map((e, i) => ({
      ...e,
      rawPose: null,
      corners:
        i % 2 === 0
          ? [e.corners[1]!, e.corners[2]!, e.corners[3]!, e.corners[0]!]
          : e.corners,
    }));
    const r = evaluateFusedQrPose(entries);
    expect(r.pose).toBeNull();
    expect(r.method).toBeNull();
    expect(r.status).toBe('measuring');
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
    // The contradiction's fit, far above the 3 px fallback bound.
    expect(r.fitPx).toBeGreaterThan(10);
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

describe('evaluateFusedQrPose hysteresis', () => {
  const code = tilted(5);
  const rand = mulberry32(9);
  const noisy = walkEntries(code, 8, { noise: { sigmaPx: 1.1, rand } });
  const tight = { maxFitPx: 0.5, fallbackFitPx: 1, hysteresis: 2 };

  // The METHOD is sticky too, keyed on the previous method (not its status):
  // a window between the fallback bound and bound x hysteresis stays joint
  // only if the previous result was joint.
  it('keeps the joint method through a fit just above the fallback bound', () => {
    const cold = evaluateFusedQrPose(noisy, tight);
    expect(cold.fitPx).toBeGreaterThan(1);
    expect(cold.fitPx).toBeLessThan(2);
    expect(cold.method).toBe('averaged');
    const previous = {
      ...cold,
      method: 'joint' as const,
      status: 'measuring' as const,
    };
    expect(evaluateFusedQrPose(noisy, tight, previous).method).toBe('joint');
  });

  // Why this test matters (review §20 #2): a stable result from ANOTHER
  // coordinate frame must not hold the gate open for the new one.
  it('does not carry the gate across a frame-epoch reset', () => {
    const clean = walkEntries(code, 8);
    const before = evaluateFusedQrPose(clean, { maxFitPx: 1, hysteresis: 2 });
    expect(before.status).toBe('stable');
    const later = noisy.map((e) => ({ ...e, frameEpoch: 1 }));
    expect(
      evaluateFusedQrPose(later, { maxFitPx: 1, hysteresis: 2 }, before).status
    ).toBe('measuring');
    // ... nor across a gap longer than gapMs in the same epoch.
    const afterGap = noisy.map((e) => ({
      ...e,
      timestamp: e.timestamp + 60_000,
    }));
    expect(
      evaluateFusedQrPose(afterGap, { maxFitPx: 1, hysteresis: 2 }, before)
        .status
    ).toBe('measuring');
    // ... nor into an OLDER window (a replay seek backwards).
    const older = noisy.map((e) => ({ ...e, timestamp: e.timestamp - 60_000 }));
    expect(
      evaluateFusedQrPose(older, { maxFitPx: 1, hysteresis: 2 }, before).status
    ).toBe('measuring');
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

  // reset() forgets the hysteresis state and the cache.
  it('forgets its previous result on reset', () => {
    const code = tilted(5);
    const tracker = createFusedQrPoseTracker({ maxFitPx: 1, hysteresis: 2 });
    expect(tracker.evaluate(walkEntries(code, 8)).status).toBe('stable');
    tracker.reset();
    const rand = mulberry32(9);
    expect(
      tracker.evaluate(walkEntries(code, 8, { noise: { sigmaPx: 1.1, rand } }))
        .status
    ).toBe('measuring');
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

describe('createFusedQrPoseTracker motion (plan §26)', () => {
  // Why these tests matter: the joint solve keeps each view's OWN position
  // and shares only the rotation, so a code slid sideways still fits well -
  // without the motion detector the gate stays open and the median position
  // trails the moving code. The owner's constraint is the other side: a
  // still code must keep today's stability while the camera walks.

  /** A code at `x` (m), yawed 5 deg, spun `spinDeg` in its own plane. */
  function codeAt(x: number, spinDeg = 0): Pose {
    const h = (5 * Math.PI) / 360;
    const s = (spinDeg * Math.PI) / 360;
    // yaw(5) * spin(z): [x, y, z, w]
    const yaw = [0, Math.sin(h), 0, Math.cos(h)] as const;
    const spin = [0, 0, Math.sin(s), Math.cos(s)] as const;
    return {
      position: [x, 1.5, 0],
      rotation: [
        yaw[3] * spin[0] +
          yaw[0] * spin[3] +
          yaw[1] * spin[2] -
          yaw[2] * spin[1],
        yaw[3] * spin[1] -
          yaw[0] * spin[2] +
          yaw[1] * spin[3] +
          yaw[2] * spin[0],
        yaw[3] * spin[2] +
          yaw[0] * spin[1] -
          yaw[1] * spin[0] +
          yaw[2] * spin[3],
        yaw[3] * spin[3] -
          yaw[0] * spin[0] -
          yaw[1] * spin[1] -
          yaw[2] * spin[2],
      ],
    };
  }

  /** Feeds a scene detection by detection; the code follows `codeOf(i)`. */
  function run(
    steps: number,
    codeOf: (i: number) => Pose,
    options: Parameters<typeof createFusedQrPoseTracker>[0] = {}
  ) {
    const cams = walkCameraPoses({
      kind: 'arc',
      codeWorld: codeAt(0),
      distanceM: 1.2,
      extent: 30,
      steps,
    });
    const entries = cams.map((cam, i) =>
      entryOf(cam, cornersOf(cam, codeOf(i)), i * 125)
    );
    const tracker = createFusedQrPoseTracker(options);
    return entries.map((_, i) => ({
      truth: codeOf(i),
      result: tracker.evaluate(entries.slice(0, i + 1)),
    }));
  }

  const positionErrorM = (a: Pose, b: Pose) =>
    Math.hypot(
      a.position[0] - b.position[0],
      a.position[1] - b.position[1],
      a.position[2] - b.position[2]
    );

  // 8 still (0-7), then 6 detections moving at 5 cm each (0.4 m/s), then
  // still. The motion starts at detection 8.
  const slide = (i: number) => codeAt(0.05 * Math.min(Math.max(i - 7, 0), 6));
  const spin = (i: number) => codeAt(0, 5 * Math.min(Math.max(i - 7, 0), 6));
  const MOTION_START = 8;

  /** Detections whose STABLE pose is off by more than the given bounds. */
  function trailing(out: ReturnType<typeof run>): number[] {
    return out
      .map((o, i) => ({ ...o, i }))
      .filter(
        ({ truth, result }) =>
          result.status === 'stable' &&
          (positionErrorM(result.pose!, truth) > 0.02 ||
            rotationAngleDeg(result.pose!.rotation, truth.rotation) > 0.5)
      )
      .map(({ i }) => i);
  }

  it('keeps a still code still and stable while the camera walks', () => {
    const out = run(16, () => codeAt(0));
    expect(out.every((o) => o.result.motion?.state === 'still')).toBe(true);
    const last = out[out.length - 1]!.result;
    expect(last.status).toBe('stable');
    expect(last.windowEntries).toBe(8);
  });

  // The owner's calm switching (4 detections, ~0.5 s) has a price, pinned
  // here: until the motion is CONFIRMED the window still fuses, so the
  // stable pose trails for at most persistence - 1 = 3 detections (up to
  // 15 cm at 0.4 m/s). From confirmation on, never.
  it('lets a stable pose trail a sliding code only until the motion is confirmed', () => {
    const out = run(32, slide);
    expect(out.some((o) => o.result.motion?.moving)).toBe(true);
    expect(trailing(out)).toEqual([
      MOTION_START,
      MOTION_START + 1,
      MOTION_START + 2,
    ]);
    const last = out[out.length - 1]!.result;
    expect(last.status).toBe('stable');
    expect(last.motion!.state).toBe('still');
    expect(last.oldestTimestamp).toBeGreaterThanOrEqual(
      last.motion!.stillSinceMs!
    );
    // Stable again at the 5th detection of the confirming still run
    // (minViews 5): the window rebuilds from the new place only.
    const stillFrom = last.motion!.stillSinceMs! / 125;
    const stableAgain = out.findIndex(
      (o, i) => i > stillFrom && o.result.status === 'stable'
    );
    expect(stableAgain).toBe(stillFrom + 4);
  });

  it('lets a stable rotation trail a turning code only until the turn is confirmed', () => {
    const out = run(32, spin);
    expect(out.some((o) => o.result.motion?.turning)).toBe(true);
    expect(trailing(out)).toEqual([
      MOTION_START,
      MOTION_START + 1,
      MOTION_START + 2,
    ]);
    // A 15 deg turn inside the window barely raises the joint fit: the gate
    // alone cannot see it.
    expect(out[MOTION_START + 2]!.result.fitPx).toBeLessThan(1);
    expect(out[out.length - 1]!.result.status).toBe('stable');
  });

  // Review §55 #4: while a turn is confirmed the window is cut to the
  // newest entry the DETECTOR read. A native newest entry of an ordered run
  // is not one of them; cut at its time, the window would be empty and the
  // result 'unknown' (no pose at all) instead of the newest ordered view.
  it('cuts a turning code at the newest ordered entry when a native one arrives', () => {
    const cams = walkCameraPoses({
      kind: 'arc',
      codeWorld: codeAt(0),
      distanceM: 1.2,
      extent: 30,
      steps: 14,
    });
    const entries: QrFusedEntry[] = cams.map((cam, i) => {
      const c = cornersOf(cam, spin(i));
      const native = i === 13;
      return {
        ...entryOf(cam, native ? [c[1]!, c[2]!, c[3]!, c[0]!] : c, i * 125),
        orderSource: native ? 'native' : 'finder',
      };
    });
    const tracker = createFusedQrPoseTracker();
    const out = entries.map((_, i) =>
      tracker.evaluate(entries.slice(0, i + 1))
    );
    expect(out[12]!.motion?.turning).toBe(true);
    const last = out[13]!;
    expect(last.status).toBe('measuring');
    expect(last.newestTimestamp).toBe(12 * 125);
    expect(last.nativeIgnored).toBe(1);
  });

  // The contrast that makes the detector necessary: each view keeps its own
  // position and only the rotation is shared, so a slide never trips the
  // fit gate - switched off, the stable pose trails the code long after the
  // point where the detector would have cut the window.
  it('without the detector, a slide gives a stable pose that trails on', () => {
    const out = run(32, slide, { motion: false });
    expect(out.every((o) => o.result.motion === null)).toBe(true);
    expect(Math.max(...trailing(out))).toBeGreaterThan(MOTION_START + 5);
    const worst = Math.max(
      ...out
        .filter((o) => o.result.status === 'stable')
        .map((o) => positionErrorM(o.result.pose!, o.truth))
    );
    expect(worst).toBeGreaterThan(0.1);
  });

  it('without the detector, a spin gives a stable rotation that trails on', () => {
    const out = run(32, spin, { motion: false });
    expect(Math.max(...trailing(out))).toBeGreaterThan(MOTION_START + 3);
  });

  // A replay seek backwards (same epoch, older timestamps) must not leave a
  // cut from the old run in the future of the new timestamps.
  it('recovers the fused pose after time goes backwards', () => {
    const cams = walkCameraPoses({
      kind: 'arc',
      codeWorld: codeAt(0),
      distanceM: 1.2,
      extent: 30,
      steps: 32,
    });
    const first = cams.map((cam, i) =>
      entryOf(cam, cornersOf(cam, slide(i)), i * 125)
    );
    const tracker = createFusedQrPoseTracker();
    for (let i = 1; i <= first.length; i++) tracker.evaluate(first.slice(0, i));
    const again = cams
      .slice(0, 8)
      .map((cam, i) => entryOf(cam, cornersOf(cam, codeAt(0)), i * 125));
    let result = tracker.evaluate(again.slice(0, 1));
    for (let i = 2; i <= again.length; i++)
      result = tracker.evaluate(again.slice(0, i));
    expect(result.status).toBe('stable');
  });

  // Raw producers (the recorder, replays) store no solved pose, so their
  // entries carry no raw pose and the detector solves positions at an
  // assumed size: it must be the tracker's, which the app sets to the
  // printed size. Shown by telling the tracker a WRONG size: a fast camera
  // sweep past a still code then reads as moving, which it cannot with the
  // right (default) size.
  it('hands its sizeM to the motion detector for entries without raw poses', () => {
    const cams = walkCameraPoses({
      kind: 'arc',
      codeWorld: codeAt(0),
      distanceM: 1.2,
      extent: 60,
      steps: 12,
    });
    const entries = cams.map((cam, i) => ({
      ...entryOf(cam, cornersOf(cam, codeAt(0)), i * 125),
      rawPose: null,
    }));
    const moving = (
      options: Parameters<typeof createFusedQrPoseTracker>[0]
    ) => {
      const tracker = createFusedQrPoseTracker(options);
      return entries.some(
        (_, i) =>
          tracker.evaluate(entries.slice(0, i + 1)).motion?.movingCandidate
      );
    };
    expect(moving({})).toBe(false);
    expect(moving({ sizeM: 0.08 })).toBe(true);
  });

  // PR #497 review: the detector's window must break at the tracker's gap.
  it('hands its gapMs to the motion detector', () => {
    const entries = walkEntries(tilted(5), 6).map((e, i) => ({
      ...e,
      timestamp: e.timestamp + (i === 5 ? 2000 : 0),
    }));
    const last = (options: Parameters<typeof createFusedQrPoseTracker>[0]) => {
      const tracker = createFusedQrPoseTracker(options);
      let r = tracker.evaluate(entries.slice(0, 1));
      for (let i = 2; i <= entries.length; i++)
        r = tracker.evaluate(entries.slice(0, i));
      return r.motion!.offsetM;
    };
    expect(last({})).not.toBeNull();
    expect(last({ gapMs: 1000 })).toBeNull();
  });

  it('carries no motion from a bare evaluation', () => {
    expect(evaluateFusedQrPose(walkEntries(tilted(5), 8)).motion).toBeNull();
  });
});

describe('evaluateFusedQrPose size on screen and why not stable (plan §34 R1)', () => {
  // Test A on r731 was stable on 68 % of locks and the JSON could not say
  // why: too few views, the fit, the fallback, or a motion cut. And no
  // field JSON recorded the code's size in px, which every pixel threshold
  // is judged against.
  it('reports the window median edge length', () => {
    const r = evaluateFusedQrPose(walkEntries(tilted(5), 8));
    expect(r.edgePx).toBeGreaterThan(95);
    expect(r.edgePx).toBeLessThan(125);
    expect(evaluateFusedQrPose([]).edgePx).toBeNull();
  });

  it('names no reason when stable', () => {
    const r = evaluateFusedQrPose(walkEntries(tilted(5), 8));
    expect(r.status).toBe('stable');
    expect(r.notStableReason).toBeNull();
  });

  it('names too few views', () => {
    const r = evaluateFusedQrPose(walkEntries(tilted(5), 3));
    expect(r.notStableReason).toBe('views');
  });

  it('names the fit when enough views agree too loosely', () => {
    const rand = mulberry32(9);
    const r = evaluateFusedQrPose(
      walkEntries(tilted(5), 8, { noise: { sigmaPx: 1.1, rand } }),
      { maxFitPx: 0.5 }
    );
    expect(r.method).toBe('joint');
    expect(r.notStableReason).toBe('fit');
  });

  it('names the fallback when the views contradict each other', () => {
    const rand = mulberry32(9);
    const r = evaluateFusedQrPose(
      walkEntries(tilted(5), 8, { noise: { sigmaPx: 1.1, rand } }),
      { maxFitPx: 0.2, fallbackFitPx: 0.3 }
    );
    expect(r.method).toBe('averaged');
    expect(r.notStableReason).toBe('fallback');
  });

  it('names a motion cut from the tracker', () => {
    const cams = walkCameraPoses({
      kind: 'arc',
      codeWorld: tilted(5),
      distanceM: 1.2,
      extent: 30,
      steps: 16,
    });
    const entries = cams.map((cam, i) =>
      entryOf(
        cam,
        cornersOf(cam, {
          ...tilted(5),
          position: [0.05 * Math.max(i - 7, 0), 1.5, 0],
        }),
        i * 125
      )
    );
    const tracker = createFusedQrPoseTracker();
    const out = entries.map((_, i) =>
      tracker.evaluate(entries.slice(0, i + 1))
    );
    const cut = out.find((r) => r.motion?.moving);
    expect(cut?.notStableReason).toBe('motion');
  });
});

describe('fused window with corner-order flips (plan §39 F0c)', () => {
  // Why these tests matter: phone runs show corner-order flips (a frame's
  // corners labelled one or two positions round). These pin what TODAY's
  // window does with them, so a fix (at the source or downstream) is
  // chosen on evidence. The chain (plan §42) removed most flips at the
  // source, so the known defect below is pinned by its SIZE: any change to
  // the window that moves it turns the test red.
  const shift = (c: Point2[], k: number): Point2[] =>
    [0, 1, 2, 3].map((i) => c[(i + k) % 4]!);
  const window = (flipped: number, k: number) => {
    const code = tilted(5);
    const cams = walkCameraPoses({
      kind: 'arc',
      codeWorld: code,
      distanceM: 1.2,
      extent: 30,
      steps: 8,
    });
    const entries = cams.map((cam, i) => {
      const c = cornersOf(cam, code);
      return entryOf(cam, i >= 8 - flipped ? shift(c, k) : c, i * 125);
    });
    const r = evaluateFusedQrPose(entries);
    return {
      r,
      errDeg: r.pose ? rotationAngleDeg(r.pose.rotation, code.rotation) : NaN,
    };
  };

  it('absorbs one flipped view of 8 (still stable, within 1.5 deg)', () => {
    for (const k of [1, 2, 3]) {
      const { r, errDeg } = window(1, k);
      expect(r.status).toBe('stable');
      expect(errDeg).toBeLessThan(1.5);
    }
  });

  it('falls back, not stable, with three or four flipped views', () => {
    for (const k of [1, 2, 3]) {
      for (const n of [3, 4]) {
        const { r } = window(n, k);
        expect(r.status).toBe('measuring');
        expect(r.notStableReason).toBe('fallback');
      }
    }
  });

  // KNOWN DEFECT (probe 2026-09-25; milestone review 2026-09-25 #5 asked
  // for its size rather than an it.fails, which passes on ANY failure):
  // two flipped views of 8 still pass the fit gate, and the STABLE
  // rotation is off by 2.4-2.8 deg without noise (up to 6.8 deg at 1 px of
  // corner noise). A fix should turn this into "within 1 deg".
  it('KNOWN DEFECT: two flipped views of 8 leave a stable pose 2-3 deg off', () => {
    for (const k of [1, 2, 3]) {
      const { r, errDeg } = window(2, k);
      expect(r.status).toBe('stable');
      expect(errDeg).toBeGreaterThan(2);
      expect(errDeg).toBeLessThan(3);
    }
  });
});

describe('native frames of an ordered code (plan §54, §55)', () => {
  // Why these tests matter: a detection whose corner order is the
  // detector's own (`native`) is 90/180 deg wrong whenever the code is
  // rolled past 45 deg in the image. On the phone every big jump had a
  // native frame on one side (§53), and a window where native frames are
  // the majority agrees with ITSELF - a stable pose 90 deg off (r734 A).
  // Once the code's order is known (a finder or chained frame in the same
  // run), its native frames must not reach the fused pose.
  const shift = (c: Point2[], k: number): Point2[] =>
    [0, 1, 2, 3].map((i) => c[(i + k) % 4]!);
  /** 8 views of a still code; the newest `native` are shifted by `k` and labelled native. */
  const labelled = (native: number, k: number) => {
    const code = tilted(5);
    const cams = walkCameraPoses({
      kind: 'arc',
      codeWorld: code,
      distanceM: 1.2,
      extent: 30,
      steps: 8,
    });
    const entries: QrFusedEntry[] = cams.map((cam, i) => {
      const isNative = i >= 8 - native;
      const c = cornersOf(cam, code);
      return {
        ...entryOf(cam, isNative ? shift(c, k) : c, i * 125),
        orderSource: isNative ? 'native' : 'finder',
      };
    });
    return { code, entries };
  };
  const errDeg = (r: ReturnType<typeof evaluateFusedQrPose>, code: Pose) =>
    r.pose ? rotationAngleDeg(r.pose.rotation, code.rotation) : Number.NaN;

  // Measured before the fix (noise-free): 6 or 7 native views of 8 gave a
  // STABLE pose 89.8-90 deg (k = 1, 3) or 180 deg (k = 2) off, fit
  // 0.15-0.53 px; 5 of 8 fell back (fit 4.5-7.3 px).
  it('never gives a stable pose off by 90 deg when 6 or 7 of 8 views are native', () => {
    for (const n of [6, 7]) {
      for (const k of [1, 2, 3]) {
        const { code, entries } = labelled(n, k);
        const r = evaluateFusedQrPose(entries);
        expect(r.status === 'stable' ? errDeg(r, code) : 0).toBeLessThan(3);
        expect(r.nativeIgnored).toBe(n);
      }
    }
  });

  it('fuses the ordered views alone: stable and correct with 2 natives in 8', () => {
    for (const k of [1, 2, 3]) {
      const { code, entries } = labelled(2, k);
      const r = evaluateFusedQrPose(entries);
      expect(r.status).toBe('stable');
      expect(errDeg(r, code)).toBeLessThan(1);
      expect(r.windowEntries).toBe(6);
      expect(r.nativeIgnored).toBe(2);
    }
  });

  // The tracker runs the motion detector on the same entries: the native
  // newest entry must neither start a window of its own nor count.
  it('keeps the tracker stable and still while native frames arrive', () => {
    const { code, entries } = labelled(2, 1);
    const t = createFusedQrPoseTracker();
    const out = entries.map((_, i) => t.evaluate(entries.slice(0, i + 1)));
    const last = out[out.length - 1]!;
    expect(last.status).toBe('stable');
    expect(errDeg(last, code)).toBeLessThan(1);
    expect(out.every((r) => !r.motion?.turningCandidate)).toBe(true);
  });

  // Direct callers of the window (the motion detector's measure, apps)
  // get the rule too, not only evaluateFusedQrPose.
  it('leaves native entries of an ordered run out of selectFusedWindow', () => {
    const { entries } = labelled(2, 1);
    const w = selectFusedWindow(entries);
    expect(w).toHaveLength(6);
    expect(w.every((e) => e.orderSource === 'finder')).toBe(true);
  });

  describe('ignoreNativeWhenOrdered', () => {
    const at = (
      timestamp: number,
      orderSource?: QrFusedEntry['orderSource'],
      frameEpoch = 0
    ): QrFusedEntry => ({
      ...entryOf(tilted(0), [], timestamp, frameEpoch),
      ...(orderSource ? { orderSource } : {}),
    });

    it('returns the same array when it drops nothing', () => {
      const unknown = [at(0), at(125), at(250)];
      expect(ignoreNativeWhenOrdered(unknown, 4000)).toBe(unknown);
      const ordered = [at(0, 'finder'), at(125, 'memory'), at(250)];
      expect(ignoreNativeWhenOrdered(ordered, 4000)).toBe(ordered);
      // Only native: the order is unknown, not known-wrong - kept.
      const native = [at(0, 'native'), at(125, 'native')];
      expect(ignoreNativeWhenOrdered(native, 4000)).toBe(native);
    });

    it('drops the native entries of a run that holds an ordered one', () => {
      const list = [
        at(0, 'native'),
        at(125, 'finder'),
        at(250, 'native'),
        at(375),
      ];
      expect(
        ignoreNativeWhenOrdered(list, 4000).map((e) => e.timestamp)
      ).toEqual([125, 375]);
    });

    // Review §55 #2: the slice caps by count, not time, so an ordered
    // entry from before a gap must not silence the natives after it (the
    // window would show the old pose as stable).
    it('keeps natives after a gap or in a newer epoch than the ordered entries', () => {
      // A native before the gap stays too: only the run's natives count.
      const before = [
        at(0, 'native'),
        at(60000, 'finder'),
        at(60125, 'native'),
      ];
      expect(
        ignoreNativeWhenOrdered(before, 4000).map((e) => e.timestamp)
      ).toEqual([0, 60000]);
      const gap = [at(0, 'finder'), at(60000, 'native'), at(60125, 'native')];
      expect(ignoreNativeWhenOrdered(gap, 4000)).toBe(gap);
      const epoch = [at(0, 'finder', 0), at(125, 'native', 1)];
      expect(ignoreNativeWhenOrdered(epoch, 4000)).toBe(epoch);
    });
  });
});
