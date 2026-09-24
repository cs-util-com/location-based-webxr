/**
 * `qrDetected` slice — unit tests.
 *
 * Why this test matters: this slice is the decoupling seam between detection
 * and the rest of the app (overlays/triggers/anchors subscribe here, not to the
 * fusion). The tests pin the locked-decision invariants: payload-keyed markers,
 * a per-marker BOUNDED ring buffer (no leak), the explicit prune path, the size
 * lifecycle, and that storing `Pose` (readonly tuples) survives the reducer.
 */

import { describe, it, expect } from 'vitest';
import { quat } from 'gl-matrix';
import type { Quaternion } from 'gps-plus-slam-js';
import {
  qrDetectedReducer,
  recordQrDetection,
  recordQrSizeEstimate,
  pruneQrDetections,
  clearQrMarker,
  clearAllQrMarkers,
  setQrMaxHistory,
  qrFrameChanged,
  selectQrFusedEntries,
  selectLatestQrDetection,
  selectQrMarker,
  selectQrSize,
  selectResolvedQrSizeM,
  selectStableQrPose,
  selectQrPoseStability,
  selectSolvedQrPose,
  medianQrPosition,
  DEFAULT_QR_MAX_HISTORY,
  type QrDetectedState,
  type QrDetectionEntry,
} from './qr-detected-slice';
import { PlanarPnpSquare } from '../ar/qr/planar-pnp';

function entry(
  text: string,
  t: number,
  pos: [number, number, number] = [0, 0, 0]
): QrDetectionEntry {
  return {
    text,
    qrPoseWorld: { position: pos, rotation: [0, 0, 0, 1] },
    qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
    reprojectionErrorPx: 1.2,
    timestamp: t,
  };
}

function init(): QrDetectedState {
  return qrDetectedReducer(undefined, { type: '@@INIT' });
}

describe('qrDetectedReducer', () => {
  it('starts empty with the default ring cap', () => {
    const s = init();
    expect(s.markers).toEqual({});
    expect(s.maxHistory).toBe(DEFAULT_QR_MAX_HISTORY);
  });

  it('creates a marker on first detection and appends newest-last', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 2)));
    const marker = selectQrMarker({ qrDetected: s }, 'A');
    expect(marker?.detections.map((d) => d.timestamp)).toEqual([1, 2]);
    expect(selectLatestQrDetection({ qrDetected: s }, 'A')?.timestamp).toBe(2);
  });

  it('keys markers by payload — distinct payloads do not merge', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    s = qrDetectedReducer(s, recordQrDetection(entry('B', 1)));
    expect(Object.keys(s.markers).sort()).toEqual(['A', 'B']);
  });

  it('preserves the readonly Pose tuples through the reducer (no draft crash)', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1, [3, 4, 5])));
    expect(
      selectLatestQrDetection({ qrDetected: s }, 'A')?.qrPoseWorld?.position
    ).toEqual([3, 4, 5]);
  });

  // Why this test matters: it pins the deliberate "return new state" design of
  // recordQrDetection/recordQrSizeEstimate against a recurring "critical" review
  // claim (PR #103) that returning `{ ...state, markers: { ...state.markers } }`
  // from an Immer/RTK reducer leaks REVOKED draft proxies — so a later read of
  // `marker.size` / `marker.detections` would throw
  // "Cannot perform 'get' on a proxy that has been revoked". That is false:
  // Immer finalizes the entire RETURNED tree, unwrapping every embedded draft,
  // so the pattern is safe. The slice returns new state on purpose because the
  // readonly Pose tuples reject Immer's WritableDraft (see the reducer jsdoc and
  // the Pose-tuple test above) — the review's suggested "fix" (mutate the draft)
  // would REINTRODUCE that crash, so this test guards against that regression too.
  it('does not leak revoked Immer draft proxies across chained dispatches', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1, [1, 2, 3])));

    // Read the exact deep properties the claim says are revoked proxies.
    const marker = s.markers['A'];
    expect(() => JSON.stringify(marker.size)).not.toThrow();
    expect(marker.size.status).toBe('unknown');
    expect(marker.detections).toHaveLength(1);

    // A second dispatch reads `existing.size` / `existing.detections` off the
    // PREVIOUSLY RETURNED state — the precise reads the claim predicts crash.
    expect(() => {
      s = qrDetectedReducer(s, recordQrDetection(entry('A', 2, [4, 5, 6])));
      // recordQrSizeEstimate also reads `existing.detections.slice()`.
      s = qrDetectedReducer(
        s,
        recordQrSizeEstimate({
          text: 'A',
          estimate: {
            status: 'estimated',
            estimateM: 0.2,
            sampleCount: 4,
            spreadM: 0.003,
          },
        })
      );
    }).not.toThrow();
    expect(s.markers['A'].detections.map((d) => d.timestamp)).toEqual([1, 2]);
    expect(s.markers['A'].size.status).toBe('estimated');
  });

  it('bounds each marker to maxHistory (ring buffer, drops oldest)', () => {
    let s = init();
    s = qrDetectedReducer(s, setQrMaxHistory(3));
    for (let t = 1; t <= 6; t++) {
      s = qrDetectedReducer(s, recordQrDetection(entry('A', t)));
    }
    const ts = selectQrMarker({ qrDetected: s }, 'A')?.detections.map(
      (d) => d.timestamp
    );
    expect(ts).toEqual([4, 5, 6]);
  });

  it('re-trims existing markers when the cap shrinks', () => {
    let s = init();
    for (let t = 1; t <= 5; t++) {
      s = qrDetectedReducer(s, recordQrDetection(entry('A', t)));
    }
    s = qrDetectedReducer(s, setQrMaxHistory(2));
    const ts = selectQrMarker({ qrDetected: s }, 'A')?.detections.map(
      (d) => d.timestamp
    );
    expect(ts).toEqual([4, 5]);
    expect(s.maxHistory).toBe(2);
  });

  it('prunes the oldest N on demand', () => {
    let s = init();
    for (let t = 1; t <= 4; t++) {
      s = qrDetectedReducer(s, recordQrDetection(entry('A', t)));
    }
    s = qrDetectedReducer(s, pruneQrDetections({ text: 'A', count: 2 }));
    const ts = selectQrMarker({ qrDetected: s }, 'A')?.detections.map(
      (d) => d.timestamp
    );
    expect(ts).toEqual([3, 4]);
  });

  it('prune is a no-op for unknown markers / non-positive counts', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    const before = s;
    s = qrDetectedReducer(s, pruneQrDetections({ text: 'missing', count: 1 }));
    s = qrDetectedReducer(s, pruneQrDetections({ text: 'A', count: 0 }));
    expect(s).toEqual(before);
  });

  it('size lifecycle: defaults to unknown, then updates', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    expect(selectQrSize({ qrDetected: s }, 'A')).toEqual({
      status: 'unknown',
      estimateM: null,
      sampleCount: 0,
      spreadM: 0,
    });
    s = qrDetectedReducer(
      s,
      recordQrSizeEstimate({
        text: 'A',
        estimate: {
          status: 'estimated',
          estimateM: 0.2,
          sampleCount: 12,
          spreadM: 0.004,
        },
      })
    );
    expect(selectQrSize({ qrDetected: s }, 'A')?.status).toBe('estimated');
    // The detection history is preserved across a size update.
    expect(selectQrMarker({ qrDetected: s }, 'A')?.detections).toHaveLength(1);
  });

  // The resolveSizeM bridge for the vote (Part B, Option a): only an
  // 'estimated' size resolves to a number; everything else stays null so the
  // controller keeps scanning rather than voting on an unconverged size.
  it('selectResolvedQrSizeM: null until estimated, then the median (Part B Option a)', () => {
    let s = init();
    // Unknown marker → null (keep scanning).
    expect(selectResolvedQrSizeM({ qrDetected: s }, 'A')).toBeNull();

    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    // status 'unknown' → still null.
    expect(selectResolvedQrSizeM({ qrDetected: s }, 'A')).toBeNull();

    // status 'measuring' (not yet converged) → still null.
    s = qrDetectedReducer(
      s,
      recordQrSizeEstimate({
        text: 'A',
        estimate: {
          status: 'measuring',
          estimateM: 0.19,
          sampleCount: 3,
          spreadM: 0.05,
        },
      })
    );
    expect(selectResolvedQrSizeM({ qrDetected: s }, 'A')).toBeNull();

    // status 'estimated' → the running-median estimateM.
    s = qrDetectedReducer(
      s,
      recordQrSizeEstimate({
        text: 'A',
        estimate: {
          status: 'estimated',
          estimateM: 0.2,
          sampleCount: 12,
          spreadM: 0.004,
        },
      })
    );
    expect(selectResolvedQrSizeM({ qrDetected: s }, 'A')).toBe(0.2);
  });

  it('size can be authored before any detection exists', () => {
    let s = init();
    s = qrDetectedReducer(
      s,
      recordQrSizeEstimate({
        text: 'A',
        estimate: {
          status: 'estimated',
          estimateM: 0.15,
          sampleCount: 1,
          spreadM: 0,
        },
      })
    );
    expect(selectQrMarker({ qrDetected: s }, 'A')?.detections).toEqual([]);
    expect(selectQrSize({ qrDetected: s }, 'A')?.estimateM).toBe(0.15);
  });

  it('clears one marker / all markers', () => {
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    s = qrDetectedReducer(s, recordQrDetection(entry('B', 1)));
    s = qrDetectedReducer(s, clearQrMarker({ text: 'A' }));
    expect(Object.keys(s.markers)).toEqual(['B']);
    s = qrDetectedReducer(s, clearAllQrMarkers());
    expect(s.markers).toEqual({});
  });
});

/** A detection entry whose world rotation is a yaw of `deg` about +Y. */
function yawEntry(text: string, t: number, deg: number): QrDetectionEntry {
  const q = quat.create();
  quat.setAxisAngle(q, [0, 1, 0], (deg * Math.PI) / 180);
  quat.normalize(q, q);
  const rotation: Quaternion = [q[0], q[1], q[2], q[3]];
  return {
    text,
    qrPoseWorld: { position: [0, 0, -1], rotation },
    qrPoseInCamera: { position: [0, 0, -1], rotation: [0, 0, 0, 1] },
    reprojectionErrorPx: 0,
    timestamp: t,
  };
}

describe('selectStableQrPose / selectQrPoseStability', () => {
  const opts = { window: 8, minObservations: 5, maxRotationSpreadDeg: 5 };

  it('is unknown / null for an unseen marker', () => {
    const s = init();
    expect(selectQrPoseStability({ qrDetected: s }, 'A', opts).status).toBe(
      'unknown'
    );
    expect(selectStableQrPose({ qrDetected: s }, 'A', opts)).toBeNull();
  });

  it('stays measuring (null) until enough low-spread observations accumulate', () => {
    let s = init();
    for (let t = 1; t <= 4; t++) {
      s = qrDetectedReducer(s, recordQrDetection(yawEntry('A', t, 30)));
    }
    // 4 < minObservations(5) → measuring, not yet trusted.
    expect(selectQrPoseStability({ qrDetected: s }, 'A', opts).status).toBe(
      'measuring'
    );
    expect(selectStableQrPose({ qrDetected: s }, 'A', opts)).toBeNull();
  });

  it('returns the filtered pose once the window converges', () => {
    let s = init();
    for (let t = 1; t <= 6; t++) {
      s = qrDetectedReducer(s, recordQrDetection(yawEntry('A', t, 30)));
    }
    expect(selectQrPoseStability({ qrDetected: s }, 'A', opts).status).toBe(
      'stable'
    );
    const pose = selectStableQrPose({ qrDetected: s }, 'A', opts);
    expect(pose).not.toBeNull();
    expect(pose!.position).toEqual([0, 0, -1]);
  });

  it('does NOT lock when a single bad-rotation frame is injected into a steady stream', () => {
    let s = init();
    for (let t = 1; t <= 5; t++) {
      s = qrDetectedReducer(s, recordQrDetection(yawEntry('A', t, 30)));
    }
    // Already stable; the filtered pose is the steady 30° yaw.
    const before = selectStableQrPose({ qrDetected: s }, 'A', opts);
    expect(before).not.toBeNull();
    // Inject one wild outlier rotation (90° off). The robust mean must reject it
    // — the stable pose must not swing toward the bad frame (regression for the
    // reported jitter feeding the vote).
    s = qrDetectedReducer(s, recordQrDetection(yawEntry('A', 6, 120)));
    const after = selectStableQrPose({ qrDetected: s }, 'A', opts);
    expect(after).not.toBeNull();
    // before/after rotations differ by < 2° despite the injected 90° outlier.
    const ga = quat.normalize(
      quat.create(),
      quat.fromValues(
        before!.rotation[0],
        before!.rotation[1],
        before!.rotation[2],
        before!.rotation[3]
      )
    );
    const gb = quat.normalize(
      quat.create(),
      quat.fromValues(
        after!.rotation[0],
        after!.rotation[1],
        after!.rotation[2],
        after!.rotation[3]
      )
    );
    const d = quat.dot(ga, gb);
    const angleDeg =
      (Math.acos(Math.min(1, Math.max(-1, 2 * d * d - 1))) * 180) / Math.PI;
    expect(angleDeg).toBeLessThan(2);
  });
});

describe('medianQrPosition', () => {
  it('returns null for an empty window', () => {
    expect(medianQrPosition([])).toBeNull();
  });

  it('is robust to a minority of outliers', () => {
    const entries = [
      entry('A', 1, [1, 1, 1]),
      entry('A', 2, [1, 1, 1]),
      entry('A', 3, [1, 1, 1]),
      entry('A', 4, [1000, 1000, 1000]),
    ];
    expect(medianQrPosition(entries)).toEqual([1, 1, 1]);
  });
});

describe('selectSolvedQrPose (derive-on-read, D-A)', () => {
  // The end-to-end "re-derives the known pose" guarantee is proven in
  // qr-derived-pose.test.ts; here we pin the slice's mapping + guard: unknown
  // markers, the D-A-2 transition (solved-only entries carry no raw fields and
  // must be skipped), and a graceful null when depth is unavailable.
  const deps = {
    resolveDepthAt: () => null, // no depth resolvable
    solver: new PlanarPnpSquare(),
  };

  it('returns null for an unknown marker', () => {
    expect(selectSolvedQrPose({ qrDetected: init() }, 'nope', deps)).toBeNull();
  });

  it('skips solved-only (legacy/transitional) entries with no raw fields', () => {
    let s = init();
    // `entry()` produces a solved-pose-only detection (no corners/cameraPose/…),
    // so even with a working depth resolver there is nothing raw to derive from.
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1, [1, 2, 3])));
    expect(
      selectSolvedQrPose({ qrDetected: s }, 'A', {
        resolveDepthAt: () => ({
          depthAt: () => 1,
          unprojector: { unproject: () => [0, 0, 0] },
        }),
        solver: new PlanarPnpSquare(),
      })
    ).toBeNull();
  });

  it('returns null when a raw entry exists but no depth covers it', () => {
    const raw: QrDetectionEntry = {
      ...entry('A', 1),
      corners: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
        { x: 10, y: 30 },
      ],
      cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      projectionMatrix: [
        1.875, 0, 0, 0, 0, 2.5, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0,
      ],
      imageWidth: 640,
      imageHeight: 480,
    };
    let s = init();
    s = qrDetectedReducer(s, recordQrDetection(raw));
    expect(selectSolvedQrPose({ qrDetected: s }, 'A', deps)).toBeNull();
  });
});

describe('the frame epoch (M3b b2)', () => {
  // Why this test matters (QR near-frontal pose plan §16 #4, §19): after an
  // odometry restart or a loop closure, older detections live in another
  // coordinate frame, and the fused window must not combine them with newer
  // ones. The slice stamps every detection with the frame epoch it arrived
  // in; the epoch moves on the recorded gpsData actions (so a replay of an
  // old recording reproduces it with no new action), on the session's own
  // restart bookkeeping (`tracking/clearLastRestartedPayload`, which reaches
  // any store holding the tracking slice), and on an explicit
  // `qrFrameChanged` for apps that have neither.
  it('stamps each detection with the current frame epoch', () => {
    let s = init();
    expect(s.frameEpoch).toBe(0);
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 1)));
    expect(s.markers['A']!.detections[0]!.frameEpoch).toBe(0);
  });

  it.each([
    'gpsData/odometryTrackingRestarted',
    'gpsData/arLoopClosureDetected',
    'tracking/clearLastRestartedPayload',
  ])('moves to the next epoch on %s', (type) => {
    let s = qrDetectedReducer(init(), recordQrDetection(entry('A', 1)));
    s = qrDetectedReducer(s, { type });
    expect(s.frameEpoch).toBe(1);
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 2)));
    const d = s.markers['A']!.detections;
    expect(d.map((e) => e.frameEpoch)).toEqual([0, 1]);
  });

  it('moves to the next epoch on qrFrameChanged', () => {
    const s = qrDetectedReducer(init(), qrFrameChanged());
    expect(s.frameEpoch).toBe(1);
  });

  // The epoch comes from the store, never from the payload: a recorded
  // payload that carries one (or a producer that guesses) cannot make a
  // replay disagree with the live run.
  it('ignores a frame epoch in the payload', () => {
    const s = qrDetectedReducer(
      init(),
      recordQrDetection({ ...entry('A', 1), frameEpoch: 7 })
    );
    expect(s.markers['A']!.detections[0]!.frameEpoch).toBe(0);
  });

  // Replay equivalence: the same recorded action stream gives the same
  // partition into epochs, whatever unrelated actions sit in between.
  it('partitions a recorded stream identically on replay', () => {
    const stream = [
      recordQrDetection(entry('A', 1)),
      { type: 'gpsData/someOtherAction' },
      recordQrDetection(entry('A', 2)),
      { type: 'gpsData/odometryTrackingRestarted' },
      recordQrDetection(entry('A', 3)),
      { type: 'gpsData/arLoopClosureDetected' },
      recordQrDetection(entry('B', 4)),
    ];
    const run = () => stream.reduce(qrDetectedReducer, init());
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.markers['A']!.detections.map((e) => e.frameEpoch)).toEqual([
      0, 0, 1,
    ]);
    expect(a.markers['B']!.detections[0]!.frameEpoch).toBe(2);
  });

  // State from before the epoch existed (a hand-built or persisted state
  // without the field) must not turn into NaN on the first restart.
  it('treats a missing epoch as 0', () => {
    const old: QrDetectedState = { maxHistory: 8, markers: {} };
    let s = qrDetectedReducer(old, recordQrDetection(entry('A', 1)));
    expect(s.markers['A']!.detections[0]!.frameEpoch).toBe(0);
    s = qrDetectedReducer(s, qrFrameChanged());
    expect(s.frameEpoch).toBe(1);
  });

  // Clearing markers is not a frame change: the epoch keeps counting.
  it('keeps the epoch through clearAllQrMarkers', () => {
    let s = qrDetectedReducer(init(), qrFrameChanged());
    s = qrDetectedReducer(s, clearAllQrMarkers());
    expect(s.frameEpoch).toBe(1);
  });
});

describe('selectQrFusedEntries (M3b b3)', () => {
  const corners = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 },
  ];
  const cameraPose = {
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  };
  const intrinsics = { fx: 500, fy: 500, cx: 320, cy: 240 };
  // A symmetric GL projection: fx = P[0] * W / 2 = 1.5 * 640 / 2 = 480.
  const projectionMatrix = [
    1.5, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0,
  ] as unknown as QrDetectionEntry['projectionMatrix'] & object;

  // Why this test matters: the fused window reads the slice through this
  // selector. It must accept both producers (the tracking controller's
  // events with intrinsics and a solved pose; the recorder's raw entries
  // with a projection matrix instead), drop what cannot feed the solve, and
  // keep the frame epoch the reducer stamped.
  it('maps event entries and raw entries, and skips unusable ones', () => {
    let s = init();
    s = qrDetectedReducer(
      s,
      recordQrDetection({ ...entry('A', 1), corners, cameraPose, intrinsics })
    );
    s = qrDetectedReducer(
      s,
      recordQrDetection({
        text: 'A',
        timestamp: 2,
        corners,
        cameraPose,
        projectionMatrix,
        imageWidth: 640,
        imageHeight: 480,
      })
    );
    s = qrDetectedReducer(s, recordQrDetection(entry('A', 3)));
    s = qrDetectedReducer(s, qrFrameChanged());
    s = qrDetectedReducer(
      s,
      recordQrDetection({ ...entry('A', 4), corners, cameraPose, intrinsics })
    );
    const mapped = selectQrFusedEntries({ qrDetected: s }, 'A');
    expect(mapped.map((e) => e.timestamp)).toEqual([1, 2, 4]);
    expect(mapped[0]!.intrinsics).toEqual(intrinsics);
    expect(mapped[0]!.rawPose).toEqual(entry('A', 1).qrPoseWorld);
    expect(mapped[1]!.intrinsics.fx).toBeCloseTo(480, 9);
    expect(mapped[1]!.rawPose).toBeNull();
    expect(mapped.map((e) => e.frameEpoch)).toEqual([0, 0, 1]);
  });

  // Why this test matters (plan §16 #5): the fused tracker caches on the
  // entries ARRAY; the TourViewer reads this every XR frame. The selector
  // must hand out the SAME array until a new detection arrives, or the
  // joint solve runs per frame.
  it('returns the same array until the detections change', () => {
    let s = qrDetectedReducer(
      init(),
      recordQrDetection({ ...entry('A', 1), corners, cameraPose, intrinsics })
    );
    const a = selectQrFusedEntries({ qrDetected: s }, 'A');
    expect(selectQrFusedEntries({ qrDetected: s }, 'A')).toBe(a);
    s = qrDetectedReducer(s, { type: 'unrelated' });
    expect(selectQrFusedEntries({ qrDetected: s }, 'A')).toBe(a);
    s = qrDetectedReducer(
      s,
      recordQrDetection({ ...entry('A', 2), corners, cameraPose, intrinsics })
    );
    expect(selectQrFusedEntries({ qrDetected: s }, 'A')).not.toBe(a);
  });

  it('is empty for an unknown marker', () => {
    expect(selectQrFusedEntries({ qrDetected: init() }, 'X')).toEqual([]);
  });
});
